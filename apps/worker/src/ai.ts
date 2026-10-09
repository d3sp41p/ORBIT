/**
 * AI writer (spec: "News, lore and AI"). Takes jobs from ai_jobs, asks
 * Claude Haiku 5.5 for the text, checks it and saves it:
 * - news: replaces an event's template text (the template is kept)
 * - bible: 2-3 sentences of culture for a new civilization, kept in the bible
 * - chronicle: the planet's chronicle, cached in planet_chronicle
 * The daily budget (AI_DAILY_BUDGET_USD) is never exceeded: a request is sent
 * only when its worst-case cost still fits. Without a key or budget every
 * text stays a template and the site works as before.
 */
import Anthropic from "@anthropic-ai/sdk";
import {
  AI_MODEL,
  AI_NEWS_FRESH_MS,
  AI_SYSTEM,
  aiNames,
  biblePrompt,
  checkNews,
  checkProse,
  chronicleFacts,
  chroniclePrompt,
  costUsd,
  DAY_MS,
  eraName,
  fmtBig,
  maxCostUsd,
  newsPrompt,
  planetName,
  W,
  type AiPlanet,
  type AiPrompt,
  type Bible,
  type CheckResult,
  type EventKind,
  type PlanetClass,
} from "@orbit/core";
import type { Pool } from "pg";

const log = (...a: unknown[]) => console.log("[ai]", ...a);

/** Jobs per batch (requests run in parallel). */
const BATCH = 6;
/** Batches per run of the loop: enough to drain a backlog quickly. */
const MAX_BATCHES = 20;

type Bibled = Bible & { lore?: { species: string; text: string } };

interface Job {
  id: string;
  kind: "news" | "bible" | "chronicle";
  wallet: string;
  life_no: number;
  event_id: string | null;
}

/** What a job wants written: the prompt, how to check the answer, how to save it. */
interface Work {
  prompt: AiPrompt;
  check(text: string): CheckResult;
  save(text: string): Promise<void>;
}

interface PlanetRow {
  name: string | null;
  nature: PlanetClass;
  era: number | null;
  water_max: number | null;
  bible: Bibled | null;
  c_name: string | null;
  c_species: string | null;
  c_capital: string | null;
  c_motto: string | null;
}

/** Planet columns for prompts: stock data, the bible and owner customisation. */
const PLANET_COLS = `h.name, coalesce(ps.nature, h.class, 'rocky') as nature,
  (ps.state ->> 'era')::int as era, (ps.state ->> 'waterMax')::float8 as water_max, ps.bible,
  c.name as c_name, c.species as c_species, c.capital as c_capital, c.motto as c_motto`;
const PLANET_JOINS = `left join holders h on h.wallet = $1
  left join planet_custom c on c.wallet = $1 and not c.hidden_by_admin`;

function aiPlanet(wallet: string, r: PlanetRow, withLore = true): AiPlanet {
  const B = r.bible;
  return {
    // Owner customisation always wins over the procedural values.
    name: r.c_name || r.name || planetName(wallet),
    nature: r.nature,
    era: r.era === null ? null : eraName(r.era, { cls: r.nature, waterMax: r.water_max ?? 1 }),
    civ: B
      ? {
          species: r.c_species || B.species,
          type: W.ctypes[B.ct]!,
          look: W.looks[B.look]!,
          capital: r.c_capital || B.capital,
          beliefs: W.ideology[B.ideo]!,
          motto: r.c_motto || W.motto[B.motto]!,
          lore: withLore && B.lore?.species === B.species ? B.lore.text : null,
        }
      : null,
  };
}

export class AiWriter {
  private readonly client: Anthropic | null;
  /** Worst-case cost of requests in flight. */
  private reserved = 0;
  private pausedUntil = 0;
  private spent = 0;
  private queued = 0;
  private note = "";

  constructor(
    private readonly db: Pool,
    key: string | null,
    private readonly budget: number,
  ) {
    this.client = key ? new Anthropic({ apiKey: key, timeout: 30_000, maxRetries: 2 }) : null;
  }

  /** For /health: never includes the key. */
  get status(): string {
    if (!this.client) return "off: ANTHROPIC_API_KEY is not set";
    if (this.budget <= 0) return "off: AI_DAILY_BUDGET_USD is 0";
    const spend = `$${this.spent.toFixed(4)} of $${this.budget.toFixed(2)} today, ${this.queued} queued`;
    if (this.spent >= this.budget) return `paused: daily budget reached (${spend})`;
    if (Date.now() < this.pausedUntil) return `paused: ${this.note} (${spend})`;
    return `on: ${spend}`;
  }

  /** One pass of the loop: clean the queue, then write while the budget allows. */
  async run(): Promise<void> {
    await this.db.query(
      `delete from ai_jobs
       where (kind = 'news' and created_at < now() - make_interval(secs => $1))
          or (attempts >= 3 and created_at < now() - interval '1 day')`,
      [AI_NEWS_FRESH_MS / 1000],
    );
    this.spent = await this.spentToday();
    this.queued = Number(
      (await this.db.query(`select count(*) from ai_jobs where attempts < 3`)).rows[0].count,
    );
    if (!this.client || this.budget <= 0 || Date.now() < this.pausedUntil) return;
    let ok = 0;
    let rejected = 0;
    for (let b = 0; b < MAX_BATCHES && this.spent < this.budget; b++) {
      const jobs = await this.claim();
      if (!jobs.length) break;
      const results = await Promise.all(jobs.map((j) => this.process(j)));
      ok += results.filter((r) => r === "ok").length;
      rejected += results.filter((r) => r === "rejected").length;
      if (results.includes("stop")) break;
    }
    if (ok || rejected)
      log(`wrote ${ok}, rejected ${rejected}; $${this.spent.toFixed(4)} spent today`);
  }

  private async spentToday(): Promise<number> {
    const { rows } = await this.db.query<{ cost_usd: string }>(
      `select cost_usd from ai_usage where date = (now() at time zone 'utc')::date`,
    );
    return Number(rows[0]?.cost_usd ?? 0);
  }

  private async claim(): Promise<Job[]> {
    const { rows } = await this.db.query<Job>(
      `update ai_jobs set locked_until = now() + interval '2 minutes', attempts = attempts + 1
       where id in (
         select id from ai_jobs
         where attempts < 3 and not_before <= now()
           and (locked_until is null or locked_until < now())
         -- a visitor waits for chronicles and culture; news newest first
         order by (kind = 'news'), created_at desc
         limit $1 for update skip locked)
       returning id, kind, wallet, life_no, event_id`,
      [BATCH],
    );
    return rows;
  }

  private done = (j: Job) => this.db.query(`delete from ai_jobs where id = $1`, [j.id]);

  private fail = (j: Job) =>
    this.db.query(
      `update ai_jobs set locked_until = null,
         not_before = now() + make_interval(secs => 60 * attempts * attempts) where id = $1`,
      [j.id],
    );

  /** Put a job back untouched (budget or a pause, not its fault). */
  private release = (j: Job) =>
    this.db.query(`update ai_jobs set locked_until = null, attempts = attempts - 1 where id = $1`, [
      j.id,
    ]);

  private async process(j: Job): Promise<"ok" | "rejected" | "skip" | "stop"> {
    let work: Work | null;
    try {
      work = await this.work(j);
    } catch (e) {
      log(`job ${j.id} (${j.kind}) failed to load:`, e instanceof Error ? e.message : e);
      await this.fail(j);
      return "rejected";
    }
    if (!work) {
      await this.done(j);
      return "skip";
    }
    const reserve = maxCostUsd(AI_SYSTEM.length + work.prompt.user.length, work.prompt.maxTokens);
    if (this.spent + this.reserved + reserve > this.budget || Date.now() < this.pausedUntil) {
      await this.release(j);
      return "stop";
    }
    this.reserved += reserve;
    try {
      const msg = await this.client!.messages.create({
        model: AI_MODEL,
        max_tokens: work.prompt.maxTokens,
        // Short rewrites need no reasoning: thinking off, low effort.
        thinking: { type: "disabled" },
        output_config: { effort: "low" },
        system: [{ type: "text", text: AI_SYSTEM, cache_control: { type: "ephemeral" } }],
        messages: [{ role: "user", content: work.prompt.user }],
      });
      await this.record(msg.usage);
      if (msg.stop_reason !== "end_turn") {
        log(`job ${j.id} (${j.kind}) stopped: ${msg.stop_reason}`);
        await this.fail(j);
        return "rejected";
      }
      const text = msg.content.map((b) => (b.type === "text" ? b.text : "")).join("");
      const r = work.check(text);
      if (!r.ok) {
        log(`job ${j.id} (${j.kind}) rejected: ${r.reason}`);
        await this.fail(j);
        return "rejected";
      }
      await work.save(r.text);
      await this.done(j);
      return "ok";
    } catch (e) {
      if (
        e instanceof Anthropic.AuthenticationError ||
        e instanceof Anthropic.PermissionDeniedError
      )
        this.pause(30 * 60_000, "the API key was rejected");
      else if (e instanceof Anthropic.RateLimitError) this.pause(60_000, "rate limited");
      else if (e instanceof Anthropic.APIError && (e.status ?? 0) >= 500)
        this.pause(60_000, "the API is unavailable");
      log(`job ${j.id} (${j.kind}) error:`, e instanceof Error ? e.message : e);
      await this.release(j);
      return "stop";
    } finally {
      this.reserved -= reserve;
    }
  }

  private pause(ms: number, note: string) {
    this.pausedUntil = Date.now() + ms;
    this.note = note;
  }

  private async record(u: Anthropic.Usage) {
    const cost = costUsd(u);
    this.spent += cost;
    const input =
      u.input_tokens + (u.cache_creation_input_tokens ?? 0) + (u.cache_read_input_tokens ?? 0);
    await this.db.query(
      `insert into ai_usage (date, requests, input_tokens, output_tokens, cost_usd)
       values ((now() at time zone 'utc')::date, 1, $1, $2, $3)
       on conflict (date) do update set requests = ai_usage.requests + 1,
         input_tokens = ai_usage.input_tokens + excluded.input_tokens,
         output_tokens = ai_usage.output_tokens + excluded.output_tokens,
         cost_usd = ai_usage.cost_usd + excluded.cost_usd`,
      [input, u.output_tokens, cost],
    );
  }

  private work(j: Job): Promise<Work | null> {
    if (j.kind === "news") return this.news(j);
    if (j.kind === "bible") return this.bible(j);
    return this.chronicle(j);
  }

  private async news(j: Job): Promise<Work | null> {
    const { rows } = await this.db.query<
      PlanetRow & { kind: EventKind; text_en: string; text_source: string }
    >(
      `select e.kind, e.text_en, e.text_source, ${PLANET_COLS}
       from planet_events e
       ${PLANET_JOINS}
       left join planet_state ps on ps.wallet = $1 and ps.life_no = e.life_no
       where e.id = $2`,
      [j.wallet, j.event_id],
    );
    const r = rows[0];
    if (!r || r.text_source !== "template") return null;
    const template = r.text_en;
    const planet = aiPlanet(j.wallet, r);
    return {
      prompt: newsPrompt(planet, { kind: r.kind, template }),
      check: (text) => checkNews(text, template, aiNames(planet)),
      save: async (text) => {
        await this.db.query(
          `update planet_events set text_template = text_en, text_en = $2, text_source = 'ai'
           where id = $1 and text_source = 'template'`,
          [j.event_id, text],
        );
      },
    };
  }

  private async bible(j: Job): Promise<Work | null> {
    const { rows } = await this.db.query<PlanetRow>(
      `select ${PLANET_COLS}
       from planet_state ps
       ${PLANET_JOINS}
       where ps.wallet = $1 and ps.life_no = $2`,
      [j.wallet, j.life_no],
    );
    const r = rows[0];
    const B = r?.bible;
    if (!r || !B || B.lore?.species === B.species) return null;
    const planet = aiPlanet(j.wallet, r, false);
    return {
      prompt: biblePrompt(planet),
      // No numbers at all: the culture text has no facts to quote.
      check: (text) => checkProse(text, "", { min: 25, max: 90 }, aiNames(planet)),
      save: async (text) => {
        await this.db.query(
          `update planet_state
           set bible = bible || jsonb_build_object('lore', jsonb_build_object('species', $3::text, 'text', $4::text))
           where wallet = $1 and life_no = $2 and bible ->> 'species' = $3`,
          [j.wallet, j.life_no, B.species, text],
        );
      },
    };
  }

  private async chronicle(j: Job): Promise<Work | null> {
    const { rows } = await this.db.query<
      PlanetRow & {
        rank: number | null;
        hold_started_at: Date;
        s: {
          temp: number;
          water: number;
          atm: number;
          life: boolean;
          lifeDay: number | null;
          civ: boolean;
          pop: number;
          tech: number;
          stab: number;
          finds: { f: number }[];
        };
      }
    >(
      `select ${PLANET_COLS}, h.rank, ps.hold_started_at, ps.state as s
       from planet_state ps
       ${PLANET_JOINS}
       where ps.wallet = $1 and ps.life_no = $2`,
      [j.wallet, j.life_no],
    );
    const r = rows[0];
    if (!r) return null;
    const ev = await this.db.query<{ id: string; day: number; text_en: string; n: string }>(
      `select id, day, text_en, count(*) over () as n from planet_events
       where wallet = $1 and life_no = $2 order by id desc limit 14`,
      [j.wallet, j.life_no],
    );
    if (!ev.rows.length) return null;
    const S = r.s;
    const days = Math.floor((Date.now() - r.hold_started_at.getTime()) / DAY_MS);
    const facts = [
      r.rank ? `Rank: #${r.rank} among holders` : "",
      `Held for ${days} days`,
      `Temperature: ${Math.round(S.temp)} °C`,
      r.nature === "rocky"
        ? `Water: ${Math.round(S.water * 100)}% of the surface; atmosphere ${S.atm.toFixed(2)} atm`
        : "",
      S.life ? `Life since day ${Math.round(S.lifeDay ?? 0)}` : "No life yet",
      S.civ
        ? `Civilization: population ${fmtBig(S.pop)}, technology ${S.tech.toFixed(2)}, stability ${Math.round(S.stab)}/100`
        : "",
      S.finds.length ? `Rare finds: ${S.finds.map((f) => W.finds[f.f]![0]).join(", ")}` : "",
    ].filter(Boolean);
    const events = [...ev.rows].reverse().map((e) => `Day ${Math.floor(e.day)}: ${e.text_en}`);
    const hash = `${ev.rows[0]!.n}:${ev.rows[0]!.id}`;
    const allowed = chronicleFacts(facts, events);
    const planet = aiPlanet(j.wallet, r);
    return {
      prompt: chroniclePrompt(planet, facts, events),
      check: (text) => checkProse(text, allowed, { min: 90, max: 280 }, aiNames(planet)),
      save: async (text) => {
        await this.db.query(
          `insert into planet_chronicle (wallet, life_no, text_en, generated_at, events_hash)
           values ($1, $2, $3, now(), $4)
           on conflict (wallet, life_no) do update
             set text_en = excluded.text_en, generated_at = now(), events_hash = excluded.events_hash`,
          [j.wallet, j.life_no, text, hash],
        );
      },
    };
  }
}
