/**
 * Mission page markup (planet and star). Pure functions that return HTML
 * from server data (PlanetCard); every data string goes through esc().
 */
import {
  auOf,
  cap1,
  ERA_LINES,
  eraName,
  esc,
  fmt,
  fmtBig,
  KIND,
  money,
  splitNews,
  STAR_TIERS,
  TAG,
  W,
  yearDays,
  type NewsItem,
  type PlanetCard,
} from "@orbit/core";
import { copy as t, LOCALE } from "./copy";

export interface SystemInfo {
  ticker: string;
  contract: string;
  mcap: number;
  count: number;
  tierIndex: number;
  /** Known only for the demo. */
  supply?: number;
  launch?: number;
}

const DAY = 86_400_000;
const fdate = (ms: number) =>
  new Date(ms).toLocaleDateString(LOCALE, { day: "numeric", month: "short" });

export function stamp(at: number) {
  const d = new Date(at);
  return (
    d.toLocaleDateString(LOCALE, {
      day: "numeric",
      month: "short",
      year: "numeric",
      timeZone: "UTC",
    }) +
    " · " +
    d.toISOString().slice(11, 16) +
    " UTC"
  );
}

export function agoText(at: number, now: number) {
  const hrs = Math.floor((now - at) / 3_600_000);
  if (hrs < 1) return t.ago.now;
  if (hrs < 48) return t.ago.h(hrs);
  return t.ago.d(Math.floor(hrs / 24));
}

function spark(vals: number[], color: string) {
  if (vals.length < 2) return "";
  const mn = Math.min(...vals),
    mx = Math.max(...vals),
    rg = mx - mn || 1;
  const pts = vals
    .map(
      (v, i) =>
        `${((i / (vals.length - 1)) * 100).toFixed(1)},${(20 - ((v - mn) / rg) * 17).toFixed(1)}`,
    )
    .join(" ");
  const ly = (20 - ((vals.at(-1)! - mn) / rg) * 17).toFixed(1);
  return `<svg viewBox="0 0 104 22" preserveAspectRatio="none" aria-hidden="true"><polyline points="${pts}" fill="none" stroke="${color}" stroke-width="1.4" vector-effect="non-scaling-stroke" stroke-linejoin="round"/><circle cx="100" cy="${ly}" r="2" fill="${color}"/></svg>`;
}

function fact(label: string, value: string | number, unit?: string, sub?: string, sp?: string) {
  return `<div class="fact"><dt>${label}</dt><dd><b>${value}</b>${unit ? `<span>${unit}</span>` : ""}</dd>${sub ? `<small>${sub}</small>` : ""}${sp || ""}</div>`;
}

function splitBig(n: number): [string, string] {
  const s = fmtBig(n);
  const m = s.match(/^([\d.,\s]+)\s?(.*)$/);
  return m ? [m[1]!.trim(), m[2]!] : [s, ""];
}

const back = `<button class="back" id="pBack">← ${t.back}</button>`;

export function starPanelHTML(sys: SystemInfo) {
  const i = sys.tierIndex,
    tier = STAR_TIERS[i]!,
    next = STAR_TIERS[i + 1];
  const extra =
    (sys.supply ? fact(t.supply, fmtBig(sys.supply)) : "") +
    (sys.launch
      ? fact(
          t.ignition,
          new Date(sys.launch).toLocaleDateString(LOCALE, {
            day: "numeric",
            month: "short",
            year: "numeric",
          }),
        )
      : "");
  return `${back}<header class="m-head"><div class="crumbs">${t.system} / ${t.starH}</div><h2>$${esc(sys.ticker)}</h2>
    <div class="status"><span class="live"></span>${t.classX} ${tier.cls}<span class="sep">·</span>${tier.name}</div>
    <p class="lede">${t.starLore}</p>
    <div class="addr"><span>${esc(sys.contract)}</span><button class="copy" data-copy="${esc(sys.contract)}">${t.copyCA}</button></div></header>
    <section class="sec"><h3>${t.fastFacts}</h3><dl class="facts">${fact(t.mcap, money(sys.mcap))}${fact(t.worldsOrbit, fmt(sys.count))}${fact(t.spectral, tier.cls, "", tier.name)}${fact(t.nextEvo, next ? money(tier.max) : t.max, "", next ? next.name : t.fully)}${extra}</dl></section>
    <section class="sec"><h3>${t.evo}</h3><div class="badges">${STAR_TIERS.map(
      (s, j) =>
        `<div class="badge ${j === i ? "on" : j > i ? "off" : ""}"><b>${s.cls} · ${s.name}</b><small>${s.max === Infinity ? "$100M+" : t.under + money(s.max)}</small></div>`,
    ).join("")}</div></section>`;
}

/** Press-release items for a list of news. */
export function newsListHTML(items: NewsItem[]) {
  return items
    .map((n) => {
      const k = KIND[n.kind];
      const [hd, bd] = splitNews(n.text);
      return `<li><div class="meta"><span class="tag t-${k}">${TAG[k]}</span><time>${stamp(n.at)}</time></div><h4>${esc(hd)}</h4>${bd ? `<p>${esc(bd)}</p>` : ""}</li>`;
    })
    .join("");
}

export function planetPanelHTML(
  c: PlanetCard,
  news: NewsItem[],
  hasMore: boolean,
  sys: Pick<SystemInfo, "ticker">,
) {
  const S = c.state,
    era = S.era,
    rock = c.nature === "rocky",
    N = c.holdersCount;
  const ofN = t.ofN(fmt(N));
  const lifeVal = S.life ? t.present : c.habitable ? (c.lifeChance ?? 0).toFixed(1) : "0";
  const lifeUnit = S.life ? "" : c.habitable ? t.perDay : "%";
  const lifeSub = S.life
    ? t.sinceDay(Math.max(1, Math.round(S.lifeDay ?? 0)))
    : c.habitable
      ? t.noLifeYet
      : t.lifeImpossible;
  const [popV, popU] = splitBig(S.pop);
  const heldFor =
    c.days < 1 ? t.hours(Math.max(1, Math.round(c.days * 24))) : t.days(Math.floor(c.days));
  const facts = [
    fact(
      t.temp,
      Math.round(S.temp),
      "°C",
      "",
      spark(
        c.hist.map((x) => x[0]),
        "#f2b33d",
      ),
    ),
    S.civ
      ? fact(
          t.pop,
          popV,
          popU,
          "",
          spark(
            c.hist.map((x) => x[1]),
            "#5fd39a",
          ),
        )
      : fact(
          t.bio,
          S.life ? fmt(Math.round(S.bio * S.bio * 2.4e6 + 12)) : "—",
          S.life ? t.speciesU : "",
          "",
          S.life
            ? spark(
                c.hist.map((x) => x[1]),
                "#5fd39a",
              )
            : "",
        ),
    fact(t.life, lifeVal, lifeUnit, lifeSub),
    rock ? fact(t.water, Math.round(S.water * 100), "%") : fact(t.rankL, "#" + c.rank, "", ofN),
    rock ? fact(t.atm, S.atm.toFixed(2), t.atmU) : fact(t.orbitNo, "#" + c.timeRank, "", ofN),
    fact(
      t.tech,
      S.civ ? S.tech.toFixed(2) : "—",
      "",
      S.civ ? `${t.kardashev} ${(0.05 + S.tech * 0.22).toFixed(2)}` : t.noCiv,
    ),
    fact(t.distance, auOf(c.orbit), t.au),
    fact(t.year, fmt(yearDays(c.orbit)), t.daysU),
    rock
      ? fact(t.rankL, "#" + c.rank, "", ofN)
      : fact(t.since, fdate(c.holdStartedAt), "", heldFor),
  ].join("");
  const stab = Math.round(S.stab);
  const tl = c.timeline
    .map((n) => {
      const k = n.kind === "formed" ? "mile" : KIND[n.kind];
      return `<li class="t-${k}"><time>${t.dayN(Math.floor(n.day))} · ${stamp(n.at)}</time><span>${esc(n.text)}</span></li>`;
    })
    .join("");
  const B = c.bible;
  const civ = B
    ? `<dl class="kv"><dt>${t.speciesL}</dt><dd>${esc(B.species)}</dd><dt>${t.typeL}</dt><dd>${W.ctypes[B.ct]}</dd><dt>${t.lookL}</dt><dd>${cap1(W.looks[B.look]!)}</dd><dt>${t.capitalL}</dt><dd>${esc(B.capital)}</dd><dt>${t.ideologyL}</dt><dd>${cap1(W.ideology[B.ideo]!)}</dd><dt>${t.mottoL}</dt><dd>«${esc(W.motto[B.motto])}»</dd></dl>`
    : `<p class="empty">${t.civNone}</p>`;
  const finds = c.finds.length
    ? `<div class="badges">${c.finds.map((f) => `<div class="badge rare"><b>${W.finds[f.f]![0]}</b><small>${t.dayN(Math.floor(f.day))}</small></div>`).join("")}</div>`
    : `<p class="empty">${t.findsNone}</p>`;
  const bon = [
    c.og,
    c.days >= 30 && c.countedSells === 0,
    c.rank <= 10,
    S.life && (S.lifeDay ?? Infinity) <= 3,
    era >= 7,
    S.catCount > 0,
    c.finds.length > 0,
  ];
  const tokens = Number(BigInt(c.balance)) / 10 ** c.decimals;
  const eraLabel = eraName(era, { cls: c.nature, waterMax: S.waterMax });
  const stabColor = stab > 60 ? "var(--good)" : stab > 35 ? "var(--amber)" : "var(--signal)";
  return `${back}<header class="m-head"><div class="crumbs">${t.system} / ${t.clsPl[c.cls]} / #${c.rank}</div><h2>${esc(c.name)}</h2>
    <div class="status"><span class="live"></span>${t.active}<span class="sep">·</span>${t.dayN(Math.floor(c.days))}<span class="sep">·</span>${eraLabel}${B && S.civ ? `<span class="sep">·</span>${W.ctypes[B.ct]}` : ""}${c.og ? `<span class="sep">·</span>OG` : ""}</div>
    <p class="lede">${ERA_LINES[era]}</p>
    <div class="addr"><span>${esc(c.wallet)}</span><button class="copy" data-copy="${esc(c.wallet)}">${t.copyBtn}</button></div>
    <div class="actions"><button class="btn" id="closeUp">${t.flyCloser}</button></div></header>
    <section class="sec"><h3>${t.fastFacts}</h3><dl class="facts">${facts}</dl>
      <div class="stab"><div class="stab-row"><span>${t.stab}</span><b>${stab} / 100</b></div><div class="bar"><i style="width:${stab}%;background:${stabColor}"></i></div><p>${t.stabHint}</p></div></section>
    <section class="sec"><h3>${t.newsH}<span>${c.newsTotal}</span></h3><ol class="press" id="pressList">${news.length ? newsListHTML(news) : `<li><p class="empty">${t.newsNone}</p></li>`}</ol>${hasMore ? `<button class="more" id="moreNews">${t.newsMore}</button>` : ""}</section>
    <section class="sec"><h3>${t.timelineH}</h3><ol class="tl">${tl}</ol></section>
    <section class="sec"><h3>${t.civH}</h3>${civ}</section>
    <section class="sec"><h3>${t.findsH}</h3>${finds}</section>
    <section class="sec"><h3>${t.holderH}</h3><dl class="kv"><dt>${t.tokens}</dt><dd class="num">${fmt(tokens)} $${esc(sys.ticker)}</dd><dt>${t.since}</dt><dd class="num">${fdate(c.holdStartedAt)} · ${heldFor}</dd><dt>${t.buysSells}</dt><dd class="num">${c.buys} / ${c.sells}</dd><dt>${t.rankL}</dt><dd class="num">#${c.rank} ${ofN}</dd><dt>${t.orbitNo}</dt><dd class="num">#${c.timeRank} ${ofN}</dd></dl></section>
    <section class="sec" style="border-bottom:0"><h3>${t.achievements}</h3><div class="badges">${t.badges.map((b, i) => `<div class="badge ${bon[i] ? "on" : "off"}"><b>${b[0]}</b><small>${b[1]}</small></div>`).join("")}</div></section>`;
}

/** Mission page of a planet destroyed after a full sell. */
export function deadPanelHTML(d: {
  wallet: string;
  name: string;
  endedAt: number;
  summary: Record<string, unknown>;
}) {
  const s = d.summary as {
    eraName?: string;
    days?: number;
    finds?: number;
    species?: string | null;
  };
  const since = Math.max(0, Date.now() - d.endedAt);
  return `${back}<header class="m-head"><div class="crumbs">${t.system} / ${t.lostH}</div><h2>${esc(d.name)}</h2>
    <div class="status"><span class="live" style="background:var(--mute);animation:none"></span>${t.destroyed}<span class="sep">·</span>${since < DAY ? agoText(d.endedAt, Date.now()) : fdate(d.endedAt)}</div>
    <p class="lede">${t.destroyedLede}</p>
    <div class="addr"><span>${esc(d.wallet)}</span><button class="copy" data-copy="${esc(d.wallet)}">${t.copyBtn}</button></div></header>
    <section class="sec"><h3>${t.lastRecord}</h3><dl class="kv"><dt>${t.lastEra}</dt><dd>${esc(s.eraName ?? "—")}</dd><dt>${t.lived}</dt><dd class="num">${t.days(Math.floor(s.days ?? 0))}</dd>${s.species ? `<dt>${t.speciesL}</dt><dd>${esc(s.species)}</dd>` : ""}<dt>${t.findsH}</dt><dd class="num">${s.finds ?? 0}</dd></dl></section>`;
}
