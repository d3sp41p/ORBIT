/**
 * Planet simulation, ported from the prototype (initSim, step, chooseEvent,
 * applyEvent, applySell, eraOf, hab, lifeChanceDay) without changing formulas
 * or the order in which random numbers are drawn.
 */
import { BALANCE } from "./config";
import { clamp, sstep } from "./math";
import { nameGen } from "./names";
import { pick, pickI, rngFor, type Rng } from "./rng";
import type { PlanetClass } from "./system";
import { W } from "./words";

/** One simulation tick in days. */
export const TICK = BALANCE.tickHours / 24;

export type EventKind =
  | "formed"
  | "cooled"
  | "volcano"
  | "iceage"
  | "warm"
  | "comet"
  | "rains"
  | "quake"
  | "flare"
  | "probe"
  | "soup"
  | "life"
  | "lifeGas"
  | "lifeAst"
  | "bloom"
  | "creature"
  | "extinction"
  | "civ"
  | "golden"
  | "breakthrough"
  | "war"
  | "pandemic"
  | "unify"
  | "election"
  | "climate"
  | "blackout"
  | "festival"
  | "moon"
  | "neighbor"
  | "storm"
  | "pebble"
  | "rare"
  | "sell"
  | "sellSmall"
  | "eraUp"
  | "eraDown"
  | "collapse";

/** Facts produced by the simulation. Texts only format these values. */
export type EventParams = Record<string, string | number | boolean>;

export interface SimEvent {
  /** Planet day (days since hold start) when it happened. */
  day: number;
  k: EventKind;
  p: EventParams;
}

export interface Bible {
  species: string;
  ct: number;
  look: number;
  capital: string;
  ideo: number;
  motto: number;
}

export interface Find {
  f: number;
  day: number;
}

/** A sell of the holder; `at` is the planet day, `frac` the share of the balance sold. */
export interface Sell {
  frac: number;
  at: number;
  /** Set by the simulation when the sell caused a catastrophe. */
  counted?: boolean;
}

export interface SimHolder {
  addr: string;
  cls: PlanetClass;
  orbit: number;
  size: number;
  sizeBonus: number;
  sells: Sell[];
}

export interface SimContext {
  /** All holders in rank order, used by the "neighbor" event. */
  neighbors: readonly { addr: string; name: string }[];
}

export interface SimState {
  r: Rng;
  day: number;
  /** Next tick number. */
  k: number;
  temp: number;
  targetT: number;
  tOff: number;
  water: number;
  waterMax: number;
  atm: number;
  atmMax: number;
  icy: boolean;
  life: boolean;
  lifeDay: number | null;
  bio: number;
  civ: boolean;
  civDay: number | null;
  pop: number;
  tech: number;
  stab: number;
  ash: number;
  dim: number;
  moons: number;
  colonies: number;
  finds: Find[];
  news: SimEvent[];
  /** Last 42 ticks: [temperature, population or biosphere, stability]. */
  hist: [number, number, number][];
  era: number;
  sellIdx: number;
  bible: Bible | null;
  rainsDone: boolean;
  catCount: number;
  soupBoost?: number;
  cont: string[];
  cities: string[];
}

export function eraOf(S: SimState): number {
  if (S.temp > 300) return 0;
  if (S.civ) {
    if (S.tech >= 4.8) return 7;
    if (S.tech >= 3.4) return 6;
    if (S.tech >= 2.2) return 5;
    if (S.tech >= 1) return 4;
    return 3;
  }
  if (S.life) return 2;
  return 1;
}

const invIdx = (S: SimState, r: Rng) =>
  clamp(Math.floor(S.tech * 2.3) + pickI(r, 3) - 1, 0, W.inventions.length - 1);

export function hab(S: SimState, h: Pick<SimHolder, "cls">): number {
  if (S.temp > 300) return 0;
  if (h.cls === "rocky") {
    const fT = Math.exp(-Math.pow((S.temp - 22) / 30, 2));
    const fW = sstep(0.06, 0.4, S.water);
    const fA = sstep(0.15, 0.6, S.atm);
    return fT * fW * fA;
  }
  if (h.cls === "asteroid") return S.icy ? 0.25 : 0;
  return 0.45;
}

export function lifeChanceDay(S: SimState, h: Pick<SimHolder, "cls">): number {
  const H = hab(S, h);
  const base = h.cls === "rocky" ? 0.4 : h.cls === "asteroid" ? 0.008 : 0.05;
  return H * base * (0.55 + S.stab / 110);
}

/**
 * Seed of the simulation generator. Life 1 uses the prototype's seed
 * (wallet + "sim"); a planet reborn after a full sell gets a new seed.
 */
export const simSeed = (addr: string, lifeNo = 1) =>
  lifeNo <= 1 ? addr + "sim" : addr + "sim" + lifeNo;

export function initSim(h: SimHolder, lifeNo = 1): SimState {
  const r = rngFor(simSeed(h.addr, lifeNo));
  const rock = h.cls === "rocky",
    ast = h.cls === "asteroid",
    giant = !rock && !ast;
  const S: SimState = {
    r,
    day: 0,
    k: 0,
    temp: rock ? 1150 : giant ? 900 : 700,
    targetT: rock
      ? 16 + ((250 - h.orbit) / 250) * 26 + (r() - 0.5) * 44
      : giant
        ? -120 + ((250 - h.orbit) / 250) * 60
        : -60 + ((250 - h.orbit) / 250) * 50,
    tOff: 0,
    water: 0,
    waterMax: rock ? (r() < 0.18 ? 0.04 + r() * 0.07 : 0.25 + r() * 0.65) : 0,
    atm: 0.05,
    atmMax: rock ? 0.25 + r() * 1.1 : giant ? 1 : 0,
    icy: ast && r() < 0.4,
    life: false,
    lifeDay: null,
    bio: 0,
    civ: false,
    civDay: null,
    pop: 0,
    tech: 0,
    stab: 28,
    ash: 0,
    dim: 0,
    moons: giant ? 2 + pickI(r, 6) : rock ? pickI(r, 3) : 0,
    colonies: 0,
    finds: [],
    news: [],
    hist: [],
    era: 0,
    sellIdx: 0,
    bible: null,
    rainsDone: false,
    catCount: 0,
    cont: [nameGen(r), nameGen(r), nameGen(r)],
    cities: [],
  };
  S.news.push({ day: 0, k: "formed", p: { temp: S.temp } });
  return S;
}

function ev(S: SimState, day: number, k: EventKind, p: EventParams = {}) {
  S.news.push({ day, k, p });
}

export function chooseEvent(S: SimState, h: SimHolder): EventKind | null {
  const r = S.r,
    rock = h.cls === "rocky",
    ast = h.cls === "asteroid",
    giant = !rock && !ast;
  const bad = 1.45 - S.stab / 100,
    good = 0.5 + S.stab / 100;
  const L: [EventKind, number][] = [];
  const add = (k: EventKind, w: number, kind: string) => {
    if (w > 0) L.push([k, w * (kind === "bad" ? bad : kind === "good" ? good : 1)]);
  };
  if (ast) {
    add("pebble", 2, "n");
    add("comet", S.icy ? 1 : 0, "g");
    add("flare", 0.6, "n");
  } else if (giant) {
    add("storm", 2.2, "n");
    add("flare", 1, "n");
    if (!S.life) add("probe", 1.2, "n");
  } else {
    if (S.temp < 300) {
      add("volcano", 0.9, "bad");
      add("iceage", S.temp > -10 ? 0.6 : 0, "bad");
      add("warm", 0.4, "n");
      add("flare", 0.5, "n");
      add("comet", S.water < S.waterMax ? 0.8 : 0, "good");
      add("rains", S.water < S.waterMax && S.water > 0.05 ? 0.9 : 0, "good");
    }
    if (!S.civ) add("quake", 0.6, "n");
    if (!S.life && S.temp < 300) {
      add("probe", 1.8, "n");
      add("soup", hab(S, h) > 0.15 ? 0.9 : 0, "good");
    }
  }
  if (S.life && !S.civ && !ast) {
    add("bloom", 1.4, "good");
    add("creature", 1.4, "n");
    add("extinction", 0.7, "bad");
  }
  if (S.civ) {
    add("golden", 0.9, "good");
    add("breakthrough", 1.2, "good");
    add("war", 0.9, "bad");
    add("pandemic", 0.6, "bad");
    add("unify", S.stab < 85 ? 0.35 : 0, "good");
    add("election", 1, "n");
    add("climate", S.tech >= 1 ? 0.5 : 0, "bad");
    add("blackout", S.tech >= 1 ? 0.5 : 0, "bad");
    add("festival", 0.6, "good");
    add("moon", S.tech >= 3.2 && S.colonies < S.moons ? 0.8 : 0, "good");
    add("neighbor", S.tech >= 2 ? 0.5 : 0, "n");
    add("creature", 0.3, "n");
  }
  let sum = 0;
  for (const [, w] of L) sum += w;
  let x = r() * sum;
  for (const [k, w] of L) {
    x -= w;
    if (x <= 0) return k;
  }
  return null;
}

export function applyEvent(
  k: EventKind,
  S: SimState,
  h: SimHolder,
  day: number,
  ctx: SimContext,
): void {
  const r = S.r;
  let p: EventParams = {};
  switch (k) {
    case "volcano":
      S.tOff += 4 + r() * 8;
      S.ash = Math.min(1, S.ash + 0.5 + r() * 0.4);
      S.atm = Math.min(1.6, S.atm + 0.05);
      p = { cont: pick(r, S.cont), n: 50 + Math.floor(r() * 900) };
      break;
    case "iceage":
      S.tOff -= 14 + r() * 16;
      p = { n: 2 + Math.floor(r() * 40) };
      break;
    case "warm":
      S.tOff += 6 + r() * 8;
      break;
    case "comet":
      S.waterMax = Math.min(0.95, S.waterMax + 0.03);
      S.water = Math.min(S.waterMax, S.water + 0.05 + r() * 0.08);
      p = { comet: nameGen(r, 2, 2), n: 2 + Math.floor(r() * 80) };
      break;
    case "rains":
      S.water = Math.min(S.waterMax, S.water + 0.04 + r() * 0.06);
      p = { n: 20 + Math.floor(r() * 300) };
      break;
    case "quake":
      p = { cont: pick(r, S.cont), m: (7 + r() * 3).toFixed(1) };
      break;
    case "flare":
      S.atm = Math.max(0, S.atm - 0.03);
      break;
    case "probe":
      break;
    case "soup":
      S.soupBoost = (S.soupBoost || 0) + 0.15;
      p = { place: pickI(r, W.places.length) };
      break;
    case "bloom":
      S.bio = Math.min(1, S.bio + 0.08 + r() * 0.1);
      p = { n: 1000 + Math.floor(r() * 90000), cr: pickI(r, W.creatures.length) };
      break;
    case "creature":
      p = { cr: pickI(r, W.creatures.length) };
      break;
    case "extinction": {
      const f = 0.2 + r() * 0.5;
      S.bio *= 1 - f;
      p = { pct: Math.round(f * 100), bio: Math.round((1 - f) * 100) };
      break;
    }
    case "golden":
      S.pop *= 1.15 + r() * 0.2;
      S.tech += 0.06 / (1 + S.tech * 0.2);
      S.stab = Math.min(100, S.stab + 6);
      p = { inv: invIdx(S, r) };
      break;
    case "breakthrough":
      S.tech += (0.1 + r() * 0.12) / (1 + S.tech * 0.2);
      p = { inv: invIdx(S, r) };
      break;
    case "war": {
      const f = 0.03 + r() * 0.25;
      S.pop *= 1 - f;
      S.tech = Math.max(0, S.tech - f * 1.6);
      S.stab = Math.max(0, S.stab - 10 - f * 40);
      S.dim = Math.min(1, S.dim + 0.5);
      const c2 = S.cities.length > 1 ? S.cities[1]! : nameGen(r);
      p = {
        city: S.cities[0] || nameGen(r),
        city2: c2,
        cs: pickI(r, W.casus.length),
        pct: Math.max(1, Math.round(f * 100)),
      };
      break;
    }
    case "pandemic": {
      const f = 0.05 + r() * 0.3;
      S.pop *= 1 - f;
      S.stab = Math.max(0, S.stab - 6);
      p = { ds: pickI(r, W.diseases.length), pct: Math.round(f * 100) };
      break;
    }
    case "unify":
      S.stab = Math.min(100, S.stab + 15);
      break;
    case "election":
      p = {
        tt: pickI(r, W.titles.length),
        leader: nameGen(r, 2, 2),
        pr: pickI(r, W.promises.length),
      };
      break;
    case "climate":
      S.tOff += 8 + r() * 10;
      S.stab = Math.max(0, S.stab - 5);
      break;
    case "blackout":
      S.dim = Math.min(1, S.dim + 0.6);
      p = { pct: 20 + Math.floor(r() * 60) };
      break;
    case "festival":
      p = { n: Math.floor(day - (S.civDay ?? 0)) };
      break;
    case "moon":
      S.colonies++;
      p = { moon: nameGen(r, 2, 2), n: S.colonies };
      break;
    case "neighbor": {
      const all = ctx.neighbors;
      const nb = all[Math.floor(r() * all.length)]!;
      p = { nb: nb.addr === h.addr ? all[0]!.name : nb.name };
      break;
    }
    case "storm":
      p = { n: 2 + Math.floor(r() * 12) };
      break;
  }
  // after-effects for text
  if (k === "volcano" || k === "iceage" || k === "warm" || k === "climate")
    p.temp = S.targetT + S.tOff + (S.atm - 0.5) * 12;
  if (k === "comet" || k === "rains") p.water = Math.round(S.water * 100);
  if (k === "probe" || k === "soup") {
    p.temp = S.temp;
    p.water = Math.round(S.water * 100);
    p.atm = S.atm.toFixed(2);
    p.chance = (lifeChanceDay(S, h) * 100).toFixed(1);
  }
  if (k === "golden" || k === "pandemic") p.pop = S.pop;
  if (k === "breakthrough") p.tech = S.tech.toFixed(2);
  if (k === "unify") p.stab = Math.round(S.stab);
  if (k === "golden" || k === "breakthrough") p.species = S.bible!.species;
  ev(S, day, k, p);
}

export function applySell(S: SimState, _h: SimHolder, day: number, s: Sell): void {
  const f = s.frac;
  if (f < BALANCE.sellIgnoreBelow) {
    ev(S, day, "sellSmall", { f: (f * 100).toFixed(1) });
    return;
  }
  s.counted = true;
  S.catCount++;
  const k = f * BALANCE.sellPenalty;
  const c = f < 0.1 ? 0 : f < 0.3 ? 1 : f < 0.6 ? 2 : f < 1 ? 3 : 4;
  S.pop *= 1 - k;
  S.bio *= 1 - k * 0.6;
  S.tech = Math.max(0, S.tech - k * 2.2);
  S.stab = Math.max(0, S.stab - k * 60);
  S.ash = Math.min(1, S.ash + k * 1.5);
  S.dim = Math.min(1, S.dim + k * 1.5);
  if (c === 2) S.tOff -= 20 + k * 20;
  else S.tOff += 4;
  ev(S, day, "sell", {
    c,
    f: Math.round(f * 100),
    a: Math.round(k * (S.civ ? 100 : 60)),
    civ: S.civ,
    tech: S.tech.toFixed(2),
  });
  if (S.civ && S.pop < 20000) {
    S.civ = false;
    S.tech = 0;
    ev(S, day, "collapse", { species: S.bible!.species });
  }
}

export function step(S: SimState, h: SimHolder, day: number, ctx: SimContext): void {
  const r = S.r,
    rock = h.cls === "rocky",
    ast = h.cls === "asteroid";
  while (S.sellIdx < h.sells.length && h.sells[S.sellIdx]!.at <= day) {
    applySell(S, h, day, h.sells[S.sellIdx]!);
    S.sellIdx++;
  }
  const stabTarget = 26 + 66 * (1 - Math.exp(-day / 22)) * (0.85 + 0.15 * (h.sizeBonus - 1));
  S.stab += (stabTarget - S.stab) * 0.035;
  const wasHot = S.temp > 300;
  const target = S.targetT + S.tOff + (S.atm - 0.5) * 12;
  S.temp += (target - S.temp) * (S.temp > 200 ? 0.3 : 0.08);
  S.tOff *= 0.975;
  S.ash *= 0.96;
  S.dim *= 0.93;
  if (wasHot && S.temp <= 300 && rock) ev(S, day, "cooled", { temp: S.temp });
  if (rock && S.temp < 100) S.water = Math.min(S.waterMax, S.water + 0.006 * (0.4 + r()));
  if (rock) S.atm += (S.atmMax - S.atm) * 0.012;
  // life
  if (!S.life) {
    const pd = lifeChanceDay(S, h) * (1 + (S.soupBoost || 0));
    if (pd > 0 && r() < pd * TICK) {
      S.life = true;
      S.lifeDay = day;
      S.bio = 0.04;
      ev(S, day, rock ? "life" : ast ? "lifeAst" : "lifeGas", {
        place: pickI(r, W.places.length),
        n: Math.max(1, Math.round(day)),
      });
    }
  }
  if (S.life) {
    const H = hab(S, h);
    S.bio = clamp(S.bio + 0.022 * H * (1 - S.bio) * (0.6 + S.stab / 140), 0, 1);
    if (H < 0.05) S.bio *= 0.995;
  }
  // civilization
  if (S.life && !S.civ && S.bio > 0.45 && !ast) {
    const pc = (rock ? 0.2 : 0.025) * (S.stab / 100);
    if (r() < pc * TICK) {
      S.civ = true;
      S.civDay = day;
      S.pop = 8000 + r() * 40000;
      if (!S.bible) {
        const ct = pickI(r, W.ctypes.length);
        S.bible = {
          species: nameGen(r, 2, 2) + "ids",
          ct,
          look: ct,
          capital: nameGen(r),
          ideo: pickI(r, W.ideology.length),
          motto: pickI(r, W.motto.length),
        };
      }
      S.cities = [S.bible.capital, nameGen(r), nameGen(r)];
      ev(S, day, "civ", {
        species: S.bible.species,
        city: S.bible.capital,
        ct: S.bible.ct,
        pop: S.pop,
      });
    }
  }
  if (S.civ) {
    const capP = Math.pow(h.size, 2) * 1.4e9 * (0.3 + S.bio) * (1 + S.tech * 0.7);
    S.pop += S.pop * 0.035 * (1 - S.pop / capP);
    S.tech += (0.004 * h.sizeBonus * (S.stab / 70) * BALANCE.speed) / (1 + S.tech * 0.35);
  }
  // random event
  if (r() < BALANCE.rareChance) {
    const f = pickI(r, W.finds.length);
    S.finds.push({ f, day });
    ev(S, day, "rare", { f });
  } else if (r() < BALANCE.eventChance * (ast ? BALANCE.asteroidEventFactor : 1)) {
    const k = chooseEvent(S, h);
    if (k) applyEvent(k, S, h, day, ctx);
  }
  // era change
  const e = eraOf(S);
  if (e !== S.era) {
    if (e > S.era && e >= 2) ev(S, day, "eraUp", { era: e });
    else if (e < S.era && e >= 1) ev(S, day, "eraDown", { era: e });
    S.era = e;
  }
  S.hist.push([S.temp, S.civ ? S.pop : S.bio, S.stab]);
  if (S.hist.length > 42) S.hist.shift();
}

/** Run ticks up to and including planet day `days`. */
export function simulateTo(S: SimState, h: SimHolder, days: number, ctx: SimContext): void {
  while (S.k * TICK <= days) {
    step(S, h, S.k * TICK, ctx);
    S.k++;
  }
}
