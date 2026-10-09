/**
 * Soundtrack of the wide promo, synthesised from scratch (no samples, no
 * third-party rights): F minor, 120 BPM, Fm-Db-Ab-Eb. Sections follow the
 * scenes of orbit-promo-wide.html; the level stays even (no ducking).
 *   node promo/music.mjs out.wav
 */
import { writeFileSync } from "node:fs";

const SR = 48000;
const DUR = 33.5;
const N = Math.round(SR * DUR);
const BPM = 120;
const BEAT = 60 / BPM;
const STEP = BEAT / 4; // 16th note
const out = process.argv[2] ?? "music.wav";

// Scene times (seconds) shared with the video.
const T = {
  drop: 3.4,
  groove: 7.3,
  card: 12.4,
  news: 18.9,
  hold: 23.2,
  sell: 25.82,
  hit: 26.95,
  outro: 29.4,
};
const CUTS = [7.3, 12.4, 18.9, 23.2, 29.4];

const L = new Float32Array(N);
const R = new Float32Array(N);
const busL = { pad: new Float32Array(N), arp: new Float32Array(N), fx: new Float32Array(N) };
const busR = { pad: new Float32Array(N), arp: new Float32Array(N), fx: new Float32Array(N) };

const mtof = (m) => 440 * Math.pow(2, (m - 69) / 12);
const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
const smooth = (x) => {
  x = clamp(x, 0, 1);
  return x * x * (3 - 2 * x);
};
let seed = 12345;
const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff) * 2 - 1;

/** RBJ biquad, coefficients updated on demand. */
class Biquad {
  constructor(type) {
    this.type = type;
    this.x1 = this.x2 = this.y1 = this.y2 = 0;
    this.set(1000, 0.7);
  }
  set(f, q) {
    const w = (2 * Math.PI * clamp(f, 20, SR * 0.45)) / SR,
      c = Math.cos(w),
      a = Math.sin(w) / (2 * q);
    let b0, b1, b2;
    if (this.type === "lp") {
      b0 = (1 - c) / 2;
      b1 = 1 - c;
      b2 = (1 - c) / 2;
    } else if (this.type === "hp") {
      b0 = (1 + c) / 2;
      b1 = -(1 + c);
      b2 = (1 + c) / 2;
    } else {
      b0 = a;
      b1 = 0;
      b2 = -a;
    } // band-pass
    const a0 = 1 + a;
    this.b0 = b0 / a0;
    this.b1 = b1 / a0;
    this.b2 = b2 / a0;
    this.a1 = (-2 * c) / a0;
    this.a2 = (1 - a) / a0;
  }
  run(x) {
    const y =
      this.b0 * x + this.b1 * this.x1 + this.b2 * this.x2 - this.a1 * this.y1 - this.a2 * this.y2;
    this.x2 = this.x1;
    this.x1 = x;
    this.y2 = this.y1;
    this.y1 = y;
    return y;
  }
}

/** Band-limited saw (polyBLEP). */
function saw(phase, dt) {
  let v = 2 * phase - 1;
  if (phase < dt) {
    const t = phase / dt;
    v -= t + t - t * t - 1;
  } else if (phase > 1 - dt) {
    const t = (phase - 1) / dt;
    v -= t * t + t + t + 1;
  }
  return v;
}

const env = (t, a, d, s, r, len) => {
  if (t < 0) return 0;
  if (t < a) return t / a;
  if (t < a + d) return 1 - (1 - s) * ((t - a) / d);
  if (t < len) return s;
  return Math.max(0, s * (1 - (t - len) / r));
};

// Chords per bar (2 s): Fm Db Ab Eb, voiced around middle C.
const CHORDS = [
  [53, 56, 60, 65], // Fm
  [49, 53, 56, 61], // Db
  [51, 56, 60, 63], // Ab (Eb in the bass voice for smooth motion)
  [51, 55, 58, 63], // Eb
];
const ROOTS = [41, 37, 44, 39];
const chordAt = (t) => Math.floor(t / (2 * 2 * BEAT)) % 4; // one chord per bar of 4 beats

/* ---------------- pad: detuned supersaw chords ---------------- */
{
  const detune = [-0.11, -0.06, -0.025, 0, 0.025, 0.06, 0.11];
  const voices = [];
  for (let n = 0; n < 4; n++)
    for (const d of detune) voices.push({ n, d, ph: Math.random(), pan: (d / 0.11) * 0.7 });
  const lpL = new Biquad("lp"),
    lpR = new Biquad("lp");
  for (let i = 0; i < N; i++) {
    const t = i / SR;
    const ch = CHORDS[chordAt(t)];
    // brighter in the groove, dark in the intro and after the hit
    const bright =
      t < T.drop
        ? 0.25 + 0.35 * smooth(t / T.drop)
        : t < T.sell
          ? 0.75
          : t < T.hit
            ? 0.75 - 0.6 * smooth((t - T.sell) / 0.9)
            : t < T.outro
              ? 0.35
              : 0.55;
    if (i % 64 === 0) {
      const f = 500 + 2600 * bright + 300 * Math.sin(t * 0.7);
      lpL.set(f, 0.8);
      lpR.set(f * 1.03, 0.8);
    }
    let sl = 0,
      sr = 0;
    for (const v of voices) {
      const f = mtof(ch[v.n] + v.d) * (v.n === 3 ? 1 : 1);
      v.ph += f / SR;
      if (v.ph >= 1) v.ph -= 1;
      const s = saw(v.ph, f / SR);
      sl += s * (0.5 - v.pan * 0.5);
      sr += s * (0.5 + v.pan * 0.5);
    }
    const lvl = 0.03 * (t < 2 ? smooth(t / 2) : 1) * (t > DUR - 3 ? smooth((DUR - t) / 3) : 1);
    busL.pad[i] = lpL.run(sl) * lvl;
    busR.pad[i] = lpR.run(sr) * lvl;
  }
}

/* ---------------- drums ---------------- */
const drumsOn = (t) => (t >= T.drop && t < T.sell) || (t >= T.outro + 0.0 && t < DUR - 2.2);
function addKick(t0, amp) {
  const i0 = Math.round(t0 * SR),
    len = Math.round(0.45 * SR);
  let ph = 0;
  for (let k = 0; k < len && i0 + k < N; k++) {
    const t = k / SR;
    const f = 45 + 130 * Math.exp(-t * 32);
    ph += f / SR;
    const body = Math.sin(2 * Math.PI * ph) * Math.exp(-t * 7.5);
    const click = k < 120 ? rnd() * (1 - k / 120) * 0.35 : 0;
    const v = Math.tanh((body + click) * 1.6) * amp;
    L[i0 + k] += v;
    R[i0 + k] += v;
  }
}
function addHat(t0, amp, open) {
  const i0 = Math.round(t0 * SR),
    dec = open ? 9 : 45,
    len = Math.round((open ? 0.25 : 0.07) * SR);
  const hp = new Biquad("hp");
  hp.set(7500, 0.7);
  const pan = 0.2 * Math.sin(t0 * 3);
  for (let k = 0; k < len && i0 + k < N; k++) {
    const v = hp.run(rnd()) * Math.exp((-k / SR) * dec) * amp;
    L[i0 + k] += v * (0.5 - pan);
    R[i0 + k] += v * (0.5 + pan);
  }
}
function addClap(t0, amp) {
  const i0 = Math.round(t0 * SR),
    len = Math.round(0.3 * SR);
  const bp = new Biquad("bp");
  bp.set(1400, 1.2);
  for (let k = 0; k < len && i0 + k < N; k++) {
    const t = k / SR;
    const bursts =
      [0, 0.011, 0.022].reduce((s, o) => s + (t >= o ? Math.exp(-(t - o) * 90) : 0), 0) +
      0.6 * Math.exp(-t * 14);
    const v = bp.run(rnd()) * bursts * amp;
    L[i0 + k] += v;
    R[i0 + k] += v;
    busL.fx[i0 + k] += v * 0.35;
    busR.fx[i0 + k] += v * 0.35; // to the reverb
  }
}
for (let s = 0; s * STEP < DUR; s++) {
  const t = s * STEP;
  if (!drumsOn(t)) continue;
  const inBar = s % 16;
  const full = t >= T.groove;
  if (inBar % 4 === 0) addKick(t, 0.62);
  if (full && (inBar === 4 || inBar === 12)) addClap(t, 0.22);
  if (full) addHat(t, inBar % 2 ? 0.05 : 0.028, inBar % 4 === 2 && s % 32 === 30);
  else if (inBar % 2 === 1) addHat(t, 0.03, false);
}
addKick(T.drop, 0.75);

/* ---------------- sub bass: off-beat 8ths ---------------- */
{
  let ph = 0,
    ph2 = 0;
  const lp = new Biquad("lp");
  lp.set(420, 0.9);
  for (let i = 0; i < N; i++) {
    const t = i / SR;
    if (!(t >= T.drop && t < T.sell) && !(t >= T.outro && t < DUR - 2.2)) continue;
    const pos = (t % BEAT) / BEAT; // position inside the beat
    const gate = pos >= 0.5 ? env((pos - 0.5) * BEAT, 0.004, 0.12, 0.55, 0.03, 0.2) : 0;
    const root = ROOTS[chordAt(t)];
    const f = mtof(root),
      f2 = mtof(root + 12);
    ph += f / SR;
    ph2 += f2 / SR;
    if (ph >= 1) ph -= 1;
    if (ph2 >= 1) ph2 -= 1;
    const v = lp.run(Math.sin(2 * Math.PI * ph) + 0.35 * saw(ph2, f2 / SR));
    const s = Math.tanh(v * 1.8) * gate * 0.3;
    L[i] += s;
    R[i] += s;
  }
}

/* ---------------- arp: 16ths through a resonant filter, ping-pong delay ---------------- */
{
  const lp = new Biquad("lp");
  let ph = 0;
  const pattern = [0, 1, 2, 3, 2, 1, 3, 2]; // chord tone order
  for (let i = 0; i < N; i++) {
    const t = i / SR;
    if (t > DUR - 1.5 || (t > T.sell + 0.6 && t < T.outro)) continue;
    const s = Math.floor(t / STEP),
      st = t - s * STEP;
    const ch = CHORDS[chordAt(t)];
    const oct = s % 16 >= 8 ? 12 : 0;
    const note = ch[pattern[s % pattern.length]] + 12 + oct;
    const f = mtof(note);
    ph += f / SR;
    if (ph >= 1) ph -= 1;
    const g = env(st, 0.002, 0.09, 0.0, 0.02, 0.1);
    // filter opens with the track: closed intro, open groove, sweep down on "sell"
    const open =
      t < T.drop
        ? 0.15 + 0.35 * smooth(t / T.drop)
        : t < T.groove
          ? 0.55
          : t < T.sell
            ? 0.8 + 0.15 * Math.sin(t * 0.9)
            : 0.3;
    if (i % 32 === 0) lp.set(300 + 5200 * open * (0.6 + 0.4 * g), 4.5);
    const v = lp.run(saw(ph, f / SR) * 0.7 + (ph < 0.5 ? 0.3 : -0.3)) * g * 0.06;
    busL.arp[i] += v;
    busR.arp[i] += v;
  }
}
/* lead pluck motif from the news scene on */
{
  const motif = [
    [0, 72 - 7 + 12],
    [3, 70],
    [6, 68],
    [10, 67],
    [12, 68],
  ]; // [16th offset in 2 bars, midi]
  const lp = new Biquad("lp");
  for (let bar2 = 0; bar2 * 8 * BEAT < DUR; bar2++) {
    const base = bar2 * 8 * BEAT;
    if (base < T.news - 0.01 || base >= T.sell - 1) continue;
    for (const [off, m] of motif) {
      const t0 = base + off * STEP,
        i0 = Math.round(t0 * SR),
        len = Math.round(0.5 * SR);
      let ph = 0;
      const f = mtof(m + 5);
      for (let k = 0; k < len && i0 + k < N; k++) {
        const t = k / SR;
        ph += f / SR;
        if (ph >= 1) ph -= 1;
        if (k % 32 === 0) lp.set(400 + 4000 * Math.exp(-t * 9), 2);
        const v = lp.run(saw(ph, f / SR)) * Math.exp(-t * 6) * 0.05;
        L[i0 + k] += v * 0.6;
        R[i0 + k] += v * 0.4;
        busL.arp[i0 + k] += v * 0.5;
        busR.arp[i0 + k] += v * 0.5;
      }
    }
  }
}

/* ---------------- transitions: short digital sweeps (quiet) ---------------- */
for (const c of CUTS) {
  const i0 = Math.round((c - 0.22) * SR),
    len = Math.round(0.34 * SR);
  const bp = new Biquad("bp");
  let ph = 0;
  for (let k = 0; k < len && i0 + k < N; k++) {
    const t = k / SR,
      x = t / 0.34;
    const f = 2400 * Math.pow(0.18, x);
    ph += f / SR;
    if (k % 32 === 0) bp.set(f * 1.5, 3);
    const e = Math.sin(Math.PI * x) ** 2;
    const v = (Math.sin(2 * Math.PI * ph) * 0.35 + bp.run(rnd()) * 0.9) * e * 0.035;
    const pan = x - 0.5;
    L[i0 + k] += v * (0.5 - pan * 0.6);
    R[i0 + k] += v * (0.5 + pan * 0.6);
    busL.fx[i0 + k] += v * 0.5;
    busR.fx[i0 + k] += v * 0.5;
  }
}

/* ---------------- "sell": riser, then the impact on "catastrophe" ---------------- */
{
  const bp = new Biquad("bp");
  let ph = 0;
  const a = T.sell - 0.2,
    b = T.hit;
  for (let i = Math.round(a * SR); i < Math.round(b * SR); i++) {
    const x = (i / SR - a) / (b - a);
    if (i % 32 === 0) bp.set(300 + 6000 * x * x, 2.5);
    const f = 110 * Math.pow(4, x);
    ph += f / SR;
    const v = (bp.run(rnd()) * 0.8 + Math.sin(2 * Math.PI * ph) * 0.25 * x) * x * x * 0.22;
    L[i] += v;
    R[i] += v;
  }
  const i0 = Math.round(b * SR);
  let p2 = 0;
  const lp = new Biquad("lp");
  for (let k = 0; k < Math.round(2.4 * SR) && i0 + k < N; k++) {
    const t = k / SR;
    const f = 30 + 60 * Math.exp(-t * 6);
    p2 += f / SR;
    if (k % 64 === 0) lp.set(200 + 6000 * Math.exp(-t * 5), 0.7);
    const boom = Math.sin(2 * Math.PI * p2) * Math.exp(-t * 1.6);
    const crack = lp.run(rnd()) * Math.exp(-t * 3.5);
    const v = Math.tanh((boom * 0.9 + crack * 0.6) * 1.4) * 0.55;
    L[i0 + k] += v;
    R[i0 + k] += v;
    busL.fx[i0 + k] += crack * 0.25;
    busR.fx[i0 + k] += crack * 0.25;
  }
}

/* ---------------- effects: ping-pong delay for the arp, reverb for pad and fx ---------------- */
{
  const d = Math.round(3 * STEP * SR),
    fb = 0.38;
  const dl = new Float32Array(N),
    dr = new Float32Array(N);
  for (let i = 0; i < N; i++) {
    const inL = busL.arp[i],
      inR = busR.arp[i];
    const pl = i >= d ? dr[i - d] : 0,
      pr = i >= d ? dl[i - d] : 0;
    dl[i] = inL + pl * fb;
    dr[i] = inR * 0 + pr * fb + (i >= d ? 0 : 0);
    L[i] += inL + pl * 0.55;
    R[i] += inR + pr * 0.55;
    busL.fx[i] += inL * 0.2;
    busR.fx[i] += inR * 0.2;
  }
}
/** Freeverb-style stereo reverb. */
function reverb(inL, inR, room = 0.86, damp = 0.35, wet = 1) {
  const combs = [1557, 1617, 1491, 1422, 1277, 1356, 1188, 1116],
    aps = [556, 441, 341, 225];
  const make = (spread) => ({
    c: combs.map((n) => ({ b: new Float32Array(n + spread), i: 0, f: 0 })),
    a: aps.map((n) => ({ b: new Float32Array(n + spread), i: 0 })),
  });
  const run = (st, x) => {
    let s = 0;
    for (const c of st.c) {
      const y = c.b[c.i];
      c.f = y * (1 - damp) + c.f * damp;
      c.b[c.i] = x + c.f * room;
      c.i = (c.i + 1) % c.b.length;
      s += y;
    }
    for (const a of st.a) {
      const y = a.b[a.i];
      a.b[a.i] = s + y * 0.5;
      a.i = (a.i + 1) % a.b.length;
      s = y - s;
    }
    return s;
  };
  const sl = make(0),
    sr = make(23);
  for (let i = 0; i < N; i++) {
    const x = (inL[i] + inR[i]) * 0.015;
    L[i] += run(sl, x) * wet;
    R[i] += run(sr, x) * wet;
  }
}
for (let i = 0; i < N; i++) {
  L[i] += busL.pad[i];
  R[i] += busR.pad[i];
  busL.fx[i] += busL.pad[i] * 0.6;
  busR.fx[i] += busR.pad[i] * 0.6;
}
reverb(busL.fx, busR.fx);

/* ---------------- master: gentle glue, soft clip, fixed gain ---------------- */
let peak = 0;
for (let i = 0; i < N; i++) {
  L[i] = Math.tanh(L[i] * 1.15) / 1.15;
  R[i] = Math.tanh(R[i] * 1.15) / 1.15;
  peak = Math.max(peak, Math.abs(L[i]), Math.abs(R[i]));
}
const gain = 0.89 / peak; // one static gain for the whole track
const buf = Buffer.alloc(44 + N * 4);
buf.write("RIFF", 0);
buf.writeUInt32LE(36 + N * 4, 4);
buf.write("WAVE", 8);
buf.write("fmt ", 12);
buf.writeUInt32LE(16, 16);
buf.writeUInt16LE(1, 20);
buf.writeUInt16LE(2, 22);
buf.writeUInt32LE(SR, 24);
buf.writeUInt32LE(SR * 4, 28);
buf.writeUInt16LE(4, 32);
buf.writeUInt16LE(16, 34);
buf.write("data", 36);
buf.writeUInt32LE(N * 4, 40);
for (let i = 0; i < N; i++) {
  buf.writeInt16LE(Math.round(clamp(L[i] * gain, -1, 1) * 32767), 44 + i * 4);
  buf.writeInt16LE(Math.round(clamp(R[i] * gain, -1, 1) * 32767), 46 + i * 4);
}
writeFileSync(out, buf);
console.log(`saved ${out} (${DUR}s, peak ${peak.toFixed(2)} -> ${(peak * gain).toFixed(2)})`);
