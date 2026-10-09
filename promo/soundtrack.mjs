/**
 * Soundtrack of the wide promo: music made from scratch with ffmpeg (no
 * samples, no third-party rights) plus the voice-over lines, ducked and mixed.
 *   node promo/soundtrack.mjs <dir with line0.mp3..line6.mp3> <out.m4a>
 * Times match the scenes in orbit-promo-wide.html.
 */
import { execFileSync } from "node:child_process";
import { join } from "node:path";

const [voiceDir, out] = process.argv.slice(2);
if (!voiceDir || !out) throw new Error("usage: node promo/soundtrack.mjs <voice dir> <out.m4a>");

const DUR = 33.5;
const SR = 48000;
/** When each voice line starts (s). */
const VOICE = [1.5, 3.6, 7.6, 12.6, 19.1, 23.4, 29.6];
const CUTS = [3.4, 7.3, 12.4, 18.9, 23.2, 29.4];
const HIT = 27.55;
const B = 60 / 110; // beat

// Chords per scene: root (Hz) and third ratio (minor 1.189, major 1.26).
const root = `if(lt(t,7.3),110,if(lt(t,12.4),87.31,if(lt(t,18.9),130.81,if(lt(t,23.2),98,if(lt(t,29.4),110,87.31)))))`;
const third = `if(lt(t,7.3),1.189,if(lt(t,23.2),1.26,if(lt(t,29.4),1.189,1.26)))`;
// Short dips at chord changes hide the phase jumps.
const dips = CUTS.map((c) => `(1-exp(-pow((t-${c})*9,2)))`).join("*");
const pad =
  `st(0,${root});st(1,${third});` +
  `0.05*(sin(2*PI*ld(0)*t)+0.7*sin(2*PI*ld(0)*ld(1)*t)+0.6*sin(2*PI*ld(0)*1.498*t)+0.35*sin(2*PI*ld(0)*2*t)+0.25*sin(2*PI*ld(0)*0.5*t))` +
  `*(0.75+0.25*sin(2*PI*0.21*t))*${dips}*min(1,t/1.2)*min(1,(${DUR}-t)/2.5)`;
const beatsOn = `(between(t,3.4,26.6)+between(t,29.4,32.4))`;
const kick = `st(0,mod(t,${B}));0.55*${beatsOn}*exp(-ld(0)*13)*sin(2*PI*(42+95*exp(-ld(0)*32))*ld(0))`;
// random(n) keeps its state in variable n: the envelope uses another one.
const hats = `st(5,mod(t+${B / 2},${B}));0.05*between(t,7.3,26.6)*(random(0)*2-1)*exp(-ld(5)*70)`;
const riser = `0.16*between(t,25.9,${HIT})*(random(1)*2-1)*pow(max(0,(t-25.9)/${(HIT - 25.9).toFixed(2)}),2.2)`;
// max(0, ...) keeps every term finite before the hit (NaN or Inf would ruin the mix).
const boom = `gte(t,${HIT})*(0.9*sin(2*PI*38*(t-${HIT}))*exp(-max(0,t-${HIT})*2.2)+0.35*(random(2)*2-1)*exp(-max(0,t-${HIT})*5))`;
const whoosh = CUTS.map((c) => `exp(-pow((t-${c})*5,2))`).join("+");
const swoosh = `0.07*(random(3)*2-1)*(${whoosh})`;

const music = [pad, kick, hats, riser, boom, swoosh];
const inputs = music.flatMap((e) => ["-f", "lavfi", "-i", `aevalsrc='${e}':s=${SR}:d=${DUR}`]);
const voices = VOICE.flatMap((_, i) => ["-i", join(voiceDir, `line${i}.mp3`)]);

const m = music.length;
const filter = [
  // music bus: pad softened, the rest as is
  `[0]lowpass=f=5200,aecho=0.8:0.7:420|780:0.25|0.18[pad]`,
  `[pad][1][2][3][4][5]amix=inputs=${m}:normalize=0,volume=0.3,aformat=channel_layouts=stereo[mus]`,
  // voice bus: each line at its time
  ...VOICE.map(
    (t, i) =>
      `[${m + i}]aresample=${SR},adelay=${Math.round(t * 1000)}:all=1,apad=whole_dur=${DUR}[v${i}]`,
  ),
  `${VOICE.map((_, i) => `[v${i}]`).join("")}amix=inputs=${VOICE.length}:normalize=0,` +
    `highpass=f=80,acompressor=threshold=-18dB:ratio=3:attack=5:release=120,volume=1.6,` +
    `aecho=0.8:0.4:60:0.12,aformat=channel_layouts=stereo,asplit=2[voice][key]`,
  // music ducks under the voice
  `[mus][key]sidechaincompress=threshold=0.02:ratio=8:attack=15:release=400[duck]`,
  `[duck][voice]amix=inputs=2:normalize=0,alimiter=limit=0.95,loudnorm=I=-14:TP=-1.5:LRA=9`,
].join(";");

execFileSync(
  "ffmpeg",
  [
    "-y",
    "-loglevel",
    "error",
    ...inputs,
    ...voices,
    "-filter_complex",
    filter,
    "-t",
    String(DUR),
    "-ar",
    String(SR),
    "-c:a",
    "aac",
    "-b:a",
    "256k",
    out,
  ],
  { stdio: "inherit" },
);
console.log(`saved ${out}`);
