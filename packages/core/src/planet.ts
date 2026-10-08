/**
 * Shared planet helpers for the worker, the API and the site.
 * Decision A (docs/DECISIONS.md): the nature of a planet (class at birth)
 * fixes the kind of simulation; size and bonuses follow the current rank.
 */
import { BALANCE } from "./config";
import { eraName, eventText, KIND } from "./events";
import { DAY_MS } from "./math";
import {
  hab,
  lifeChanceDay,
  type Bible,
  type Find,
  type Sell,
  type SimEvent,
  type SimHolder,
  type SimState,
} from "./sim";
import { sizeBonusOf, sizeOf, type PlanetClass } from "./system";
import { visualOf, type PlanetVisual } from "./visual";

/** Global-feed rule from the prototype (gWorthy). */
export function isNotable(e: Pick<SimEvent, "k">, nature: PlanetClass): boolean {
  const k = KIND[e.k];
  if (k === "neutral") return e.k === "election" || e.k === "neighbor";
  if (nature === "asteroid") return k === "mile" || k === "rare";
  return true;
}

/** Simulation input for one tick: nature fixed, size and bonus from the current rank. */
export function simHolder(p: {
  wallet: string;
  nature: PlanetClass;
  orbit: number;
  rank: number;
  holdersCount: number;
  sells: Sell[];
}): SimHolder {
  return {
    addr: p.wallet,
    cls: p.nature,
    orbit: p.orbit,
    size: sizeOf(p.rank),
    sizeBonus: sizeBonusOf(p.rank, Math.max(2, p.holdersCount)),
    sells: p.sells,
  };
}

/** Rings: enough days without a counted sell (rocky worlds only in the top 120). */
export function ringsOf(p: { nature: PlanetClass; days: number; sells: Sell[]; rank: number }) {
  return (
    p.nature !== "asteroid" &&
    p.days >= BALANCE.ringsAfterDays &&
    p.sells.every((s) => !s.counted) &&
    (p.nature !== "rocky" || p.rank <= 120)
  );
}

/** Compact planet entry for the 3D scene (GET /api/system). */
export interface ScenePlanet {
  wallet: string;
  name: string;
  rank: number;
  timeRank: number;
  /** Class by current rank (sets size). */
  cls: PlanetClass;
  /** Class at birth (sets the look and the simulation). */
  nature: PlanetClass;
  era: number;
  waterMax: number;
  visual: PlanetVisual;
  rings: boolean;
  /** Counted sells, for crater density. */
  craters: number;
  og: boolean;
  /** Short status line for hover labels. */
  eraLabel: string;
}

export function scenePlanet(p: {
  wallet: string;
  name: string;
  rank: number;
  timeRank: number;
  cls: PlanetClass;
  nature: PlanetClass;
  state: Pick<
    SimState,
    "era" | "waterMax" | "temp" | "water" | "bio" | "civ" | "tech" | "pop" | "ash" | "dim" | "atm"
  >;
  days: number;
  sells: Sell[];
}): ScenePlanet {
  return {
    wallet: p.wallet,
    name: p.name,
    rank: p.rank,
    timeRank: p.timeRank,
    cls: p.cls,
    nature: p.nature,
    era: p.state.era,
    waterMax: p.state.waterMax,
    visual: visualOf(p.state, p.nature),
    rings: ringsOf({ nature: p.nature, days: p.days, sells: p.sells, rank: p.rank }),
    craters: p.sells.filter((s) => s.counted).length,
    og: p.timeRank <= 50,
    eraLabel: eraName(p.state.era, { cls: p.nature, waterMax: p.state.waterMax }),
  };
}

/** News item as shown on the site. */
export interface NewsItem {
  id: string;
  wallet: string;
  kind: SimEvent["k"];
  day: number;
  /** ms since epoch */
  at: number;
  text: string;
  notable: boolean;
}

/** Full mission page data (GET /api/planet/:wallet). */
export interface PlanetCard {
  wallet: string;
  name: string;
  rank: number;
  timeRank: number;
  holdersCount: number;
  cls: PlanetClass;
  nature: PlanetClass;
  orbit: number;
  lifeNo: number;
  /** ms since epoch */
  holdStartedAt: number;
  days: number;
  balance: string;
  decimals: number;
  buys: number;
  sells: number;
  countedSells: number;
  og: boolean;
  state: {
    temp: number;
    water: number;
    waterMax: number;
    atm: number;
    life: boolean;
    lifeDay: number | null;
    bio: number;
    civ: boolean;
    pop: number;
    tech: number;
    stab: number;
    era: number;
    catCount: number;
  };
  /** Chance of life per day in %, null when life is impossible or present. */
  lifeChance: number | null;
  habitable: boolean;
  hist: [number, number, number][];
  bible: Bible | null;
  finds: Find[];
  news: NewsItem[];
  newsTotal: number;
}

export function cardFromState(p: {
  wallet: string;
  name: string;
  rank: number;
  timeRank: number;
  holdersCount: number;
  cls: PlanetClass;
  nature: PlanetClass;
  orbit: number;
  lifeNo: number;
  holdStartedAt: number;
  now: number;
  balance: string;
  decimals: number;
  buys: number;
  sells: Sell[];
  sellCount: number;
  state: SimState | Omit<SimState, "r" | "news">;
  news: NewsItem[];
  newsTotal: number;
}): PlanetCard {
  const S = p.state;
  const h = { cls: p.nature };
  const habitable = hab(S as SimState, h) > 0;
  return {
    wallet: p.wallet,
    name: p.name,
    rank: p.rank,
    timeRank: p.timeRank,
    holdersCount: p.holdersCount,
    cls: p.cls,
    nature: p.nature,
    orbit: p.orbit,
    lifeNo: p.lifeNo,
    holdStartedAt: p.holdStartedAt,
    days: (p.now - p.holdStartedAt) / DAY_MS,
    balance: p.balance,
    decimals: p.decimals,
    buys: p.buys,
    sells: p.sellCount,
    countedSells: p.sells.filter((s) => s.counted).length,
    og: p.timeRank <= 50,
    state: {
      temp: S.temp,
      water: S.water,
      waterMax: S.waterMax,
      atm: S.atm,
      life: S.life,
      lifeDay: S.lifeDay,
      bio: S.bio,
      civ: S.civ,
      pop: S.pop,
      tech: S.tech,
      stab: S.stab,
      era: S.era,
      catCount: S.catCount,
    },
    lifeChance: !S.life && habitable ? lifeChanceDay(S as SimState, h) * 100 : null,
    habitable,
    hist: S.hist,
    bible: S.bible,
    finds: S.finds,
    news: p.news,
    newsTotal: p.newsTotal,
  };
}

/** News item from a simulation event. */
export function newsItem(
  e: SimEvent,
  p: { wallet: string; nature: PlanetClass; waterMax: number; holdStartedAt: number; id: string },
): NewsItem {
  return {
    id: p.id,
    wallet: p.wallet,
    kind: e.k,
    day: e.day,
    at: p.holdStartedAt + e.day * DAY_MS,
    text: eventText(e, { cls: p.nature, waterMax: p.waterMax }),
    notable: isNotable(e, p.nature),
  };
}
