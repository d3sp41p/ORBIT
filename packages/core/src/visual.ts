import { clamp, sstep } from "./math";
import type { SimState } from "./sim";
import type { PlanetClass } from "./system";

/** Shader inputs derived from the simulation state (prototype's syncVisual). */
export interface PlanetVisual {
  lava: number;
  water: number;
  bio: number;
  city: number;
  ice: number;
  ash: number;
  dim: number;
  /** Atmosphere glow strength for rocky worlds; null keeps the class default. */
  atmo: number | null;
}

type VisualInput = Pick<
  SimState,
  "temp" | "water" | "bio" | "civ" | "tech" | "pop" | "ash" | "dim" | "atm"
>;

export function visualOf(S: VisualInput, cls: PlanetClass): PlanetVisual {
  const lava = clamp((S.temp - 250) / 600, 0, 1);
  return {
    lava,
    water: clamp(S.water / 0.9, 0, 1),
    bio: S.bio,
    city: S.civ
      ? clamp(0.12 + S.tech / 5.5, 0, 1) * clamp(Math.log10(Math.max(S.pop, 1)) / 9, 0, 1)
      : 0,
    ice: cls === "rocky" ? sstep(-2, -38, S.temp) : 0,
    ash: S.ash,
    dim: S.dim,
    atmo: cls === "rocky" ? 1.1 * clamp(S.atm, 0, 1) * (1 - lava) : null,
  };
}
