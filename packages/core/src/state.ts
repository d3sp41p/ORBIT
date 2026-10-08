/**
 * Persisting and resuming the simulation on the server.
 *
 * planet_state stores `state` (plain JSON) and `rng_state` (the generator's
 * 32-bit state). Restoring both continues exactly the same history, so a
 * worker restart gives the same result as running without interruption.
 */
import { BALANCE } from "./config";
import { mulberry32 } from "./rng";
import { step, TICK, type SimContext, type SimEvent, type SimHolder, type SimState } from "./sim";

/** Simulation state as stored in planet_state.state. Events live in planet_events. */
export type StoredState = Omit<SimState, "r" | "news">;

export interface SavedSim {
  state: StoredState;
  rngState: number;
}

/** Snapshot for the database. News is not stored here: events go to planet_events. */
export function saveState(S: SimState): SavedSim {
  const { r, news: _news, ...rest } = S;
  return { state: JSON.parse(JSON.stringify(rest)) as StoredState, rngState: r.state };
}

export function loadState(saved: SavedSim): SimState {
  const state = JSON.parse(JSON.stringify(saved.state)) as StoredState;
  return { ...state, r: mulberry32(saved.rngState), news: [] };
}

/** Milliseconds between ticks (4 hours). Integer, so tick times never drift. */
export const TICK_MS = BALANCE.tickHours * 3_600_000;

/** Wall-clock time of tick k for a planet whose hold started at holdStartMs. */
export const tickAt = (holdStartMs: number, k: number) => holdStartMs + k * TICK_MS;

export interface AdvanceResult {
  /** Events produced by the ticks that ran, oldest first. */
  events: SimEvent[];
  ticks: number;
  /** When the next tick is due (planet_state.next_tick_at). */
  nextTickAt: number;
}

/**
 * Run every tick that is due by `nowMs` (ticks run every 4 hours from the
 * start of the hold). Sells in `h.sells` up to a tick's day are applied at
 * the start of that tick. `maxTicks` lets the worker catch up in batches.
 */
export function advance(
  S: SimState,
  h: SimHolder,
  holdStartMs: number,
  nowMs: number,
  ctx: SimContext,
  maxTicks = Infinity,
): AdvanceResult {
  const before = S.news.length;
  let ticks = 0;
  while (ticks < maxTicks && tickAt(holdStartMs, S.k) <= nowMs) {
    step(S, h, S.k * TICK, ctx);
    S.k++;
    ticks++;
  }
  return { events: S.news.slice(before), ticks, nextTickAt: tickAt(holdStartMs, S.k) };
}
