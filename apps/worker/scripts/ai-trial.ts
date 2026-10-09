/**
 * Trial of the AI prompts on the live Claude API, without the database:
 * random events of the demo system go through the same prompts and checks
 * the worker uses. Prints every text, the pass rate and the cost.
 *   pnpm --filter @orbit/worker exec tsx scripts/ai-trial.ts [news count]
 * Costs a few cents at most.
 */
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import Anthropic from "@anthropic-ai/sdk";
import {
  AI_MODEL,
  AI_SYSTEM,
  aiNames,
  aiKinds,
  biblePrompt,
  checkNews,
  checkProse,
  chronicleFacts,
  chroniclePrompt,
  costUsd,
  eraName,
  eventText,
  generateDemoSystem,
  mulberry32,
  newsPrompt,
  numbersIn,
  W,
  type AiPlanet,
  type AiPrompt,
  type CheckResult,
  type DemoHolder,
} from "@orbit/core";
import dotenv from "dotenv";

const rootEnv = fileURLToPath(new URL("../../../.env.local", import.meta.url));
if (existsSync(rootEnv)) dotenv.config({ path: rootEnv, quiet: true });
if (!process.env.ANTHROPIC_API_KEY) throw new Error("ANTHROPIC_API_KEY is not set");

const client = new Anthropic();
let spent = 0;

async function ask(p: AiPrompt): Promise<string> {
  const msg = await client.messages.create({
    model: AI_MODEL,
    max_tokens: p.maxTokens,
    thinking: { type: "disabled" },
    output_config: { effort: "low" },
    system: [{ type: "text", text: AI_SYSTEM, cache_control: { type: "ephemeral" } }],
    messages: [{ role: "user", content: p.user }],
  });
  spent += costUsd(msg.usage);
  if (msg.stop_reason !== "end_turn") return `[stopped: ${msg.stop_reason}]`;
  return msg.content.map((b) => (b.type === "text" ? b.text : "")).join("");
}

const planetOf = (h: DemoHolder): AiPlanet => ({
  name: h.name,
  nature: h.cls,
  era: eraName(h.S.era, { cls: h.cls, waterMax: h.S.waterMax }),
  civ: h.S.bible
    ? {
        species: h.S.bible.species,
        type: W.ctypes[h.S.bible.ct]!,
        look: W.looks[h.S.bible.look]!,
        capital: h.S.bible.capital,
        beliefs: W.ideology[h.S.bible.ideo]!,
        motto: W.motto[h.S.bible.motto]!,
        lore: null,
      }
    : null,
});

const show = (label: string, r: CheckResult, text: string) =>
  console.log(
    `${r.ok ? "OK  " : "FAIL"} ${label}\n     ${text.trim()}${r.ok ? "" : `\n     -> ${r.reason}`}\n`,
  );

const { holders } = generateDemoSystem(Date.UTC(2026, 9, 9));
const rnd = mulberry32(42);
const want = Number(process.argv[2] ?? 50);

// Random events that would get an AI text (by each planet's rank).
const pool = holders.flatMap((h) => {
  const kinds = new Set(aiKinds(h.rank));
  return h.S.news.filter((e) => kinds.has(e.k)).map((e) => ({ h, e }));
});
const picked = Array.from({ length: want }, () => pool[Math.floor(rnd() * pool.length)]!);

let ok = 0;
let numbersMatch = 0;
for (const { h, e } of picked) {
  const template = eventText(e, { cls: h.cls, waterMax: h.S.waterMax });
  const text = await ask(newsPrompt(planetOf(h), { kind: e.k, template }));
  const r = checkNews(text, template, aiNames(planetOf(h)));
  if (r.ok) {
    ok++;
    // Independent audit: the same set of numbers on both sides.
    const a = [...new Set(numbersIn(template))].sort().join(",");
    const b = [
      ...new Set(numbersIn(aiNames(planetOf(h)).reduce((t, n) => t.split(n).join(" "), r.text))),
    ]
      .sort()
      .join(",");
    if (a === b) numbersMatch++;
  }
  show(`news ${e.k} · ${h.name} #${h.rank}\n     template: ${template}`, r, text);
}

const civs = holders.filter((h) => h.S.bible).slice(0, 3);
let bibleOk = 0;
for (const h of civs) {
  const text = await ask(biblePrompt(planetOf(h)));
  const r = checkProse(text, "", { min: 25, max: 90 }, aiNames(planetOf(h)));
  if (r.ok) bibleOk++;
  show(`culture · ${h.name}`, r, text);
}

let chronOk = 0;
for (const h of [civs[0], holders[5]].filter(Boolean) as DemoHolder[]) {
  const S = h.S;
  const facts = [
    `Rank: #${h.rank} among holders`,
    `Held for ${Math.floor(h.days)} days`,
    `Temperature: ${Math.round(S.temp)} °C`,
    S.life ? `Life since day ${Math.round(S.lifeDay ?? 0)}` : "No life yet",
  ];
  const events = S.news
    .slice(-14)
    .map((e) => `Day ${Math.floor(e.day)}: ${eventText(e, { cls: h.cls, waterMax: S.waterMax })}`);
  const text = await ask(chroniclePrompt(planetOf(h), facts, events));
  const r = checkProse(
    text,
    chronicleFacts(facts, events),
    { min: 90, max: 280 },
    aiNames(planetOf(h)),
  );
  if (r.ok) chronOk++;
  show(`chronicle · ${h.name}`, r, text);
}

console.log(
  `news ${ok}/${picked.length} passed, numbers identical in ${numbersMatch}/${ok}; ` +
    `culture ${bibleOk}/${civs.length}; chronicle ${chronOk}/2; cost $${spent.toFixed(4)}`,
);
