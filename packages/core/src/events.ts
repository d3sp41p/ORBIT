/**
 * Event texts (English templates from the prototype's EV.en), event kinds
 * and era names. Every number in a text comes from the event params.
 */
import { cap1, celsius as C, fmt, fmtBig } from "./format";
import type { EventKind, EventParams, SimEvent } from "./sim";
import type { PlanetClass } from "./system";
import { W } from "./words";

export const ERAS = [
  "Molten birth",
  "Oceans",
  "Life",
  "First cities",
  "Industry",
  "Orbit",
  "Space age",
  "Megastructure",
] as const;

export const ERA_LINES = [
  "Molten crust and lava rivers. Nothing can live here yet.",
  "Water and air, but no life yet. Everything depends on luck now.",
  "Life has taken hold and is spreading.",
  "The first city lights glow on the night side.",
  "Cities are linking into glowing networks.",
  "Satellites and a station now circle the planet.",
  "Ships travel to neighbouring worlds and moons.",
  "A ring-world encircles the planet. Few civilizations get here.",
] as const;

/** Catastrophe names by sell severity (0 = smallest). */
export const CATASTROPHES = [
  "Meteor strike",
  "Asteroid impact",
  "Nuclear winter",
  "Extinction event",
  "Planet destroyed",
] as const;

export interface EraContext {
  cls: PlanetClass;
  /** Maximum water share of a rocky planet; dry worlds get their own era-1 name. */
  waterMax: number;
}

export function eraName(era: number, h?: EraContext): string {
  if (era === 1 && h) {
    if (h.cls === "asteroid") return "Bare rock";
    if (h.cls !== "rocky") return "Storm atmosphere";
    if (h.waterMax < 0.12) return "Dry world";
  }
  return ERAS[era]!;
}

export type NewsKind = "neutral" | "bad" | "good" | "mile" | "rare";

export const KIND: Record<EventKind, NewsKind> = {
  formed: "neutral",
  cooled: "neutral",
  volcano: "bad",
  iceage: "bad",
  warm: "neutral",
  comet: "good",
  rains: "good",
  quake: "neutral",
  flare: "neutral",
  probe: "neutral",
  soup: "good",
  life: "mile",
  lifeGas: "mile",
  lifeAst: "mile",
  bloom: "good",
  creature: "neutral",
  extinction: "bad",
  civ: "mile",
  golden: "good",
  breakthrough: "good",
  war: "bad",
  pandemic: "bad",
  unify: "good",
  election: "neutral",
  climate: "bad",
  blackout: "bad",
  festival: "good",
  moon: "good",
  neighbor: "neutral",
  storm: "neutral",
  pebble: "neutral",
  rare: "rare",
  sell: "bad",
  sellSmall: "neutral",
  eraUp: "mile",
  eraDown: "bad",
  collapse: "bad",
};

/** Press-release labels for each news kind. */
export const TAG: Record<NewsKind, string> = {
  mile: "Milestone",
  rare: "Discovery",
  bad: "Alert",
  good: "Progress",
  neutral: "Report",
};

type P = EventParams & { name?: string; line?: string };
const n = (v: unknown) => Number(v);
const s = (v: unknown) => String(v);
const at = <T>(list: readonly T[], i: unknown) => list[n(i)]!;

const EV: Record<EventKind, (p: P) => string> = {
  formed: (p) =>
    `The planet formed from dust at the edge of the system. Its surface is ${C(n(p.temp))}.`,
  cooled: (p) => `The crust cooled to ${C(n(p.temp))}. The first rains began.`,
  volcano: (p) =>
    `A supervolcano on the continent of ${s(p.cont)} threw out ${fmt(n(p.n))} million tonnes of ash. The sky darkened; temperature is ${C(n(p.temp))}.`,
  iceage: (p) =>
    `An ice age has begun: the average temperature fell to ${C(n(p.temp))}. Glaciers advance ${s(p.n)} m a day.`,
  warm: (p) =>
    `The greenhouse effect strengthened: the average temperature rose to ${C(n(p.temp))}.`,
  comet: (p) =>
    `Comet ${s(p.comet)} hit the southern hemisphere and delivered ${s(p.n)} trillion tonnes of ice. Water now covers ${s(p.water)}% of the surface.`,
  rains: (p) =>
    `It has rained for ${s(p.n)} days straight. Oceans cover ${s(p.water)}% of the surface.`,
  quake: (p) =>
    `A magnitude ${s(p.m)} quake split the continent of ${s(p.cont)}. No casualties, since nobody lives there.`,
  flare: () =>
    `A stellar flare lit auroras all the way to the equator. Beautiful, though the atmosphere thinned a little.`,
  probe: (p) =>
    `Status: ${C(n(p.temp))}, water ${s(p.water)}%, atmosphere ${s(p.atm)} atm. Chance of life: ${s(p.chance)}% per day.`,
  soup: (p) =>
    `Complex organic molecules spotted ${at(W.places, p.place)}. Chance of life rose to ${s(p.chance)}% per day.`,
  life: (p) =>
    `Life! The first microbes appeared ${at(W.places, p.place)}. It took ${s(p.n)} days.`,
  lifeGas: (p) => `Life! The first aeroplankton drift in the upper clouds. It took ${s(p.n)} days.`,
  lifeAst: (p) =>
    `Against all odds, living bacteria were found in the asteroid's ice. It took ${s(p.n)} days.`,
  bloom: (p) =>
    `Evolution is on a roll: ${fmt(n(p.n))} new species. The most notable: ${at(W.creatures, p.cr)}.`,
  creature: (p) => `New species: ${at(W.creatures, p.cr)}. Evolution offers no explanation.`,
  extinction: (p) =>
    `Mass extinction: ${s(p.pct)}% of species vanished. The biosphere shrank to ${s(p.bio)}% of its former size.`,
  civ: (p) =>
    `The ${s(p.species)} founded their first city, ${s(p.city)}. Civilization type: ${at(W.ctypes, p.ct).toLowerCase()}. Population: ${fmt(n(p.pop))}.`,
  golden: (p) =>
    `Golden age: the ${s(p.species)} invented ${at(W.inventions, p.inv)}. Population grew to ${fmtBig(n(p.pop))}.`,
  breakthrough: (p) =>
    `Breakthrough: the ${s(p.species)} invented ${at(W.inventions, p.inv)}. Technology: ${s(p.tech)}.`,
  war: (p) =>
    `War between ${s(p.city)} and ${s(p.city2)}. The cause: ${at(W.casus, p.cs)}. ${s(p.pct)}% of the population died.`,
  pandemic: (p) =>
    `Pandemic of ${at(W.diseases, p.ds)}. Population fell ${s(p.pct)}%, to ${fmtBig(n(p.pop))}.`,
  unify: (p) => `All nations united under one government. Stability rose to ${s(p.stab)}.`,
  election: (p) =>
    `${at(W.titles, p.tt)} ${s(p.leader)} won the election by promising ${at(W.promises, p.pr)}.`,
  climate: (p) =>
    `Climate crisis: industry heated the planet to ${C(n(p.temp))}. Scientists ask everyone to hold and not panic.`,
  blackout: (p) =>
    `Grid failure: ${s(p.pct)}% of night-side lights went dark. The local squirrels are to blame, as usual.`,
  festival: (p) =>
    `The whole world celebrates day ${s(p.n)} of civilization. Fireworks are visible from orbit.`,
  moon: (p) => `A colony was founded on the moon ${s(p.moon)}. Colonies so far: ${s(p.n)}.`,
  neighbor: (p) =>
    `Telescopes spotted lights on planet ${s(p.nb)}. A greeting was sent; no reply yet.`,
  storm: (p) =>
    `A new storm the size of ${s(p.n)} Earths is spinning up in the southern belt. Forecasters advise not flying past.`,
  pebble: () =>
    `A fridge-sized pebble hit the asteroid. The asteroid does not seem to have noticed.`,
  rare: (p) =>
    `Incredible find: ${at(W.finds, p.f)[1]}. It is now part of the planet's collection forever.`,
  sell: (p) =>
    `${at(CATASTROPHES, p.c)}: the holder sold ${s(p.f)}% of their tokens. ${
      p.civ
        ? `Population −${s(p.a)}%, technology fell back to ${s(p.tech)}.`
        : `Biosphere −${s(p.a)}%.`
    }`,
  sellSmall: (p) =>
    `The holder sold ${s(p.f)}% of their tokens. Too little for the planet to notice.`,
  eraUp: (p) => `A new era: ${s(p.name)}. ${s(p.line)}`,
  eraDown: (p) => `Back to the “${s(p.name)}” era. Recovery will take a while.`,
  collapse: (p) =>
    `The ${s(p.species)} civilization has fallen. Only ruins and very sad squirrels remain.`,
};

/** English text of an event. `h` gives the planet context for era names. */
export function eventText(e: SimEvent, h: EraContext): string {
  const p: P = { ...e.p };
  if (e.k === "eraUp" || e.k === "eraDown") {
    p.name = eraName(n(e.p.era), h);
    p.line = ERA_LINES[n(e.p.era)];
  }
  return EV[e.k](p);
}

/** Split a news text into headline and body, as press releases. */
export function splitNews(x: string): [string, string] {
  let i = x.indexOf(": ");
  if (i > 0 && i < 72) return [x.slice(0, i), cap1(x.slice(i + 2))];
  i = x.search(/[.!?»]\s/);
  if (i > 0 && i < x.length - 3) return [x.slice(0, i + 1), x.slice(i + 2)];
  return [x, ""];
}
