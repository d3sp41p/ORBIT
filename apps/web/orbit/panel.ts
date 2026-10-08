/**
 * Mission page markup (planet and star). Pure functions that return HTML;
 * every data string goes through esc().
 */
import {
  auOf,
  cap1,
  DAY_MS,
  eraName,
  ERA_LINES,
  esc,
  eventText,
  fmt,
  fmtBig,
  hab,
  KIND,
  lifeChanceDay,
  money,
  splitNews,
  STAR_TIERS,
  TAG,
  W,
  yearDays,
  type DemoHolder,
  type SimEvent,
} from "@orbit/core";
import { copy as t, LOCALE } from "./copy";

export interface SystemInfo {
  ticker: string;
  contract: string;
  mcap: number;
  supply: number;
  launch: number;
  count: number;
  tierIndex: number;
}

const fdate = (ms: number) =>
  new Date(ms).toLocaleDateString(LOCALE, { day: "numeric", month: "short" });

export function stamp(h: DemoHolder, day: number) {
  const d = new Date(h.start + day * DAY_MS);
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

export function agoText(h: DemoHolder, day: number, now: number) {
  const ms = now - (h.start + day * DAY_MS);
  const hrs = Math.floor(ms / 3600000);
  if (hrs < 1) return t.ago.now;
  if (hrs < 48) return t.ago.h(hrs);
  return t.ago.d(Math.floor(hrs / 24));
}

export const newsOf = (e: SimEvent, h: DemoHolder) =>
  eventText(e, { cls: h.cls, waterMax: h.S.waterMax });

export const eraLabel = (h: DemoHolder) => eraName(h.S.era, { cls: h.cls, waterMax: h.S.waterMax });

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
  const ignition = new Date(sys.launch).toLocaleDateString(LOCALE, {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
  return `${back}<header class="m-head"><div class="crumbs">${t.system} / ${t.starH}</div><h2>$${esc(sys.ticker)}</h2>
    <div class="status"><span class="live"></span>${t.classX} ${tier.cls}<span class="sep">·</span>${tier.name}</div>
    <p class="lede">${t.starLore}</p>
    <div class="addr"><span>${esc(sys.contract)}</span><button class="copy" data-copy="${esc(sys.contract)}">${t.copyCA}</button></div></header>
    <section class="sec"><h3>${t.fastFacts}</h3><dl class="facts">${fact(t.mcap, money(sys.mcap))}${fact(t.worldsOrbit, fmt(sys.count))}${fact(t.spectral, tier.cls, "", tier.name)}${fact(t.nextEvo, next ? money(tier.max) : t.max, "", next ? next.name : t.fully)}${fact(t.supply, fmtBig(sys.supply))}${fact(t.ignition, ignition)}</dl></section>
    <section class="sec"><h3>${t.evo}</h3><div class="badges">${STAR_TIERS.map(
      (s, j) =>
        `<div class="badge ${j === i ? "on" : j > i ? "off" : ""}"><b>${s.cls} · ${s.name}</b><small>${s.max === Infinity ? "$100M+" : t.under + money(s.max)}</small></div>`,
    ).join("")}</div></section>`;
}

export function planetPanelHTML(h: DemoHolder, sys: SystemInfo, newsShown: number) {
  const S = h.S,
    N = sys.count,
    counted = h.sells.filter((s) => s.counted),
    Hh = S.hist,
    era = S.era,
    rock = h.cls === "rocky";
  const ofN = t.ofN(fmt(N));
  const hasHab = hab(S, h) > 0;
  const lifeVal = S.life ? t.present : hasHab ? (lifeChanceDay(S, h) * 100).toFixed(1) : "0";
  const lifeUnit = S.life ? "" : hasHab ? t.perDay : "%";
  const lifeSub = S.life
    ? t.sinceDay(Math.max(1, Math.round(S.lifeDay ?? 0)))
    : hasHab
      ? t.noLifeYet
      : t.lifeImpossible;
  const [popV, popU] = splitBig(S.pop);
  const heldFor =
    h.days < 1 ? t.hours(Math.max(1, Math.round(h.days * 24))) : t.days(Math.floor(h.days));
  const facts = [
    fact(
      t.temp,
      Math.round(S.temp),
      "°C",
      "",
      spark(
        Hh.map((x) => x[0]),
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
            Hh.map((x) => x[1]),
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
                Hh.map((x) => x[1]),
                "#5fd39a",
              )
            : "",
        ),
    fact(t.life, lifeVal, lifeUnit, lifeSub),
    rock ? fact(t.water, Math.round(S.water * 100), "%") : fact(t.rankL, "#" + h.rank, "", ofN),
    rock ? fact(t.atm, S.atm.toFixed(2), t.atmU) : fact(t.orbitNo, "#" + h.timeRank, "", ofN),
    fact(
      t.tech,
      S.civ ? S.tech.toFixed(2) : "—",
      "",
      S.civ ? `${t.kardashev} ${(0.05 + S.tech * 0.22).toFixed(2)}` : t.noCiv,
    ),
    fact(t.distance, auOf(h.orbit), t.au),
    fact(t.year, fmt(yearDays(h.orbit)), t.daysU),
    rock ? fact(t.rankL, "#" + h.rank, "", ofN) : fact(t.since, fdate(h.start), "", heldFor),
  ].join("");
  const stab = Math.round(S.stab);
  const news = [...S.news].reverse();
  const press = news
    .slice(0, newsShown)
    .map((e) => {
      const k = KIND[e.k];
      const [hd, bd] = splitNews(newsOf(e, h));
      return `<li><div class="meta"><span class="tag t-${k}">${TAG[k]}</span><time>${stamp(h, e.day)}</time></div><h4>${esc(hd)}</h4>${bd ? `<p>${esc(bd)}</p>` : ""}</li>`;
    })
    .join("");
  const tl = S.news
    .filter(
      (e) =>
        ["mile", "rare"].includes(KIND[e.k]) ||
        e.k === "sell" ||
        e.k === "collapse" ||
        e.k === "eraDown" ||
        e.k === "formed",
    )
    .slice(-12)
    .reverse()
    .map((e) => {
      const k = e.k === "formed" ? "mile" : KIND[e.k];
      return `<li class="t-${k}"><time>${t.dayN(Math.floor(e.day))} · ${stamp(h, e.day)}</time><span>${esc(newsOf(e, h))}</span></li>`;
    })
    .join("");
  const B = S.bible;
  const civ = B
    ? `<dl class="kv"><dt>${t.speciesL}</dt><dd>${esc(B.species)}</dd><dt>${t.typeL}</dt><dd>${W.ctypes[B.ct]}</dd><dt>${t.lookL}</dt><dd>${cap1(W.looks[B.look]!)}</dd><dt>${t.capitalL}</dt><dd>${esc(B.capital)}</dd><dt>${t.ideologyL}</dt><dd>${cap1(W.ideology[B.ideo]!)}</dd><dt>${t.mottoL}</dt><dd>«${esc(W.motto[B.motto])}»</dd></dl>`
    : `<p class="empty">${t.civNone}</p>`;
  const finds = S.finds.length
    ? `<div class="badges">${S.finds.map((f) => `<div class="badge rare"><b>${W.finds[f.f]![0]}</b><small>${t.dayN(Math.floor(f.day))}</small></div>`).join("")}</div>`
    : `<p class="empty">${t.findsNone}</p>`;
  const bon = [
    h.og,
    h.days >= 30 && counted.length === 0,
    h.rank <= 10,
    S.life && (S.lifeDay ?? Infinity) <= 3,
    era >= 7,
    S.catCount > 0,
    S.finds.length > 0,
  ];
  const actions = `<div class="actions"><button class="btn" id="closeUp">${t.flyCloser}</button></div>`;
  const stabColor = stab > 60 ? "var(--good)" : stab > 35 ? "var(--amber)" : "var(--signal)";
  return `${back}<header class="m-head"><div class="crumbs">${t.system} / ${t.clsPl[h.cls]} / #${h.rank}</div><h2>${esc(h.name)}</h2>
    <div class="status"><span class="live"></span>${t.active}<span class="sep">·</span>${t.dayN(Math.floor(h.days))}<span class="sep">·</span>${eraLabel(h)}${B && S.civ ? `<span class="sep">·</span>${W.ctypes[B.ct]}` : ""}${h.og ? `<span class="sep">·</span>OG` : ""}</div>
    <p class="lede">${ERA_LINES[era]}</p>
    <div class="addr"><span>${esc(h.addr)}</span><button class="copy" data-copy="${esc(h.addr)}">${t.copyBtn}</button></div>
    ${actions}</header>
    <section class="sec"><h3>${t.fastFacts}</h3><dl class="facts">${facts}</dl>
      <div class="stab"><div class="stab-row"><span>${t.stab}</span><b>${stab} / 100</b></div><div class="bar"><i style="width:${stab}%;background:${stabColor}"></i></div><p>${t.stabHint}</p></div></section>
    <section class="sec"><h3>${t.newsH}<span>${news.length}</span></h3><ol class="press">${press || `<li><p class="empty">${t.newsNone}</p></li>`}</ol>${news.length > newsShown ? `<button class="more" id="moreNews">${t.newsMore}</button>` : ""}</section>
    <section class="sec"><h3>${t.timelineH}</h3><ol class="tl">${tl}</ol></section>
    <section class="sec"><h3>${t.civH}</h3>${civ}</section>
    <section class="sec"><h3>${t.findsH}</h3>${finds}</section>
    <section class="sec"><h3>${t.holderH}</h3><dl class="kv"><dt>${t.tokens}</dt><dd class="num">${fmt(h.bal)} $${esc(sys.ticker)}</dd><dt>${t.share}</dt><dd class="num">${((h.bal / sys.supply) * 100).toFixed(3)}% · ≈ ${money((sys.mcap * h.bal) / sys.supply)}</dd><dt>${t.since}</dt><dd class="num">${fdate(h.start)} · ${heldFor}</dd><dt>${t.buysSells}</dt><dd class="num">${h.buys} / ${h.sells.length}</dd><dt>${t.rankL}</dt><dd class="num">#${h.rank} ${ofN}</dd><dt>${t.orbitNo}</dt><dd class="num">#${h.timeRank} ${ofN}</dd></dl></section>
    <section class="sec" style="border-bottom:0"><h3>${t.achievements}</h3><div class="badges">${t.badges.map((b, i) => `<div class="badge ${bon[i] ? "on" : "off"}"><b>${b[0]}</b><small>${b[1]}</small></div>`).join("")}</div></section>`;
}
