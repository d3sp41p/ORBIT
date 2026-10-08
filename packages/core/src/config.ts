/**
 * Game balance parameters. This is the only place they may change
 * (spec: "Simulation", "Launch and operations"). Values match CONFIG in
 * reference/ORBIT_prototype.html. Never change them retroactively without
 * the owner's approval: played history is not recomputed.
 */
export const BALANCE = {
  /** Simulation step, hours. */
  tickHours: 4,
  /** Event chance per tick (asteroids use eventChance * asteroidEventFactor). */
  eventChance: 0.33,
  asteroidEventFactor: 0.35,
  /** Rare find chance per tick. */
  rareChance: 1 / 6000,
  /** Global technology growth multiplier. */
  speed: 1.0,
  /** Stability and technology bonus of rank #1. */
  sizeBonusMax: 2.0,
  /** Progress rollback multiplier on a sell. */
  sellPenalty: 1.0,
  /** Sells below this share of the balance have no consequences. */
  sellIgnoreBelow: 0.02,
  /** Rings appear after this many days without sells. */
  ringsAfterDays: 30,
} as const;

export type Balance = typeof BALANCE;
