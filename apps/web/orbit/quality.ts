/**
 * Graphics quality levels. Auto mode starts from a device guess and steps
 * down when the measured frame rate is too low. A manual choice is kept in
 * this browser only.
 */
export type Quality = "high" | "medium" | "low";
export type QualityPref = Quality | "auto";

export interface QualitySpec {
  maxDpr: number;
  skyRes: number;
  nearStars: number;
  bloom: boolean;
  /** Highest planet mesh detail allowed. */
  maxDetail: "hi" | "mid";
}

export const QUALITY: Record<Quality, QualitySpec> = {
  high: { maxDpr: 2, skyRes: 1024, nearStars: 16000, bloom: true, maxDetail: "hi" },
  medium: { maxDpr: 1.5, skyRes: 1024, nearStars: 9000, bloom: true, maxDetail: "hi" },
  low: { maxDpr: 1, skyRes: 512, nearStars: 4000, bloom: false, maxDetail: "mid" },
};

export const QUALITY_ORDER: Quality[] = ["high", "medium", "low"];
export const PREF_ORDER: QualityPref[] = ["auto", "high", "medium", "low"];

const KEY = "orbit-quality";

export function loadPref(): QualityPref {
  try {
    const v = localStorage.getItem(KEY);
    if (v && (PREF_ORDER as string[]).includes(v)) return v as QualityPref;
  } catch {
    // storage unavailable: fall back to auto
  }
  return "auto";
}

export function savePref(p: QualityPref) {
  try {
    if (p === "auto") localStorage.removeItem(KEY);
    else localStorage.setItem(KEY, p);
  } catch {
    // storage unavailable: the choice lasts for this visit only
  }
}

interface DeviceHints {
  width: number;
  coarsePointer: boolean;
  cores: number;
  memoryGb?: number;
}

/** First guess before any frame is measured. */
export function guessQuality(d: DeviceHints): Quality {
  const phone = d.coarsePointer && d.width < 900;
  if (phone || d.width < 760) return d.cores >= 8 && (d.memoryGb ?? 4) >= 6 ? "medium" : "low";
  if (d.cores <= 4 || (d.memoryGb !== undefined && d.memoryGb <= 4)) return "medium";
  return "high";
}

/**
 * Frame-rate watcher for auto mode: averages fps over a window and asks to
 * step down when it is below the target. Stops after reaching "low".
 */
export class FpsGovernor {
  private frames = 0;
  private elapsed = 0;
  private skip: number;

  constructor(
    private readonly onStepDown: () => boolean,
    private readonly target = 40,
    private readonly window = 3,
    warmup = 4,
  ) {
    this.skip = warmup;
  }

  /** Feed the real frame delta in seconds. */
  tick(dt: number) {
    // A long frame means the page was throttled (hidden or occluded window),
    // not that the device is slow: drop the current sample window.
    if (dt > 0.25) {
      this.frames = 0;
      this.elapsed = 0;
      return;
    }
    if (this.skip > 0) {
      this.skip -= dt;
      return;
    }
    this.frames++;
    this.elapsed += dt;
    if (this.elapsed < this.window) return;
    const fps = this.frames / this.elapsed;
    this.frames = 0;
    this.elapsed = 0;
    if (fps < this.target) {
      // give the new level a moment before measuring again
      if (this.onStepDown()) this.skip = 1.5;
    }
  }
}
