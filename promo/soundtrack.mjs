/**
 * Final mix of the wide promo: the synthesised music (promo/music.mjs) at one
 * fixed, moderate level and the voice lines on top. No ducking and no
 * dynamic loudness control: every gain here is a constant, so nothing swells
 * or dips during the video.
 *   node promo/soundtrack.mjs <music.wav> <voice dir with line0..line6.mp3> <out.m4a>
 */
import { execFileSync, spawnSync } from "node:child_process";
import { join } from "node:path";

const [music, voiceDir, out] = process.argv.slice(2);
if (!music || !voiceDir || !out)
  throw new Error("usage: node promo/soundtrack.mjs <music.wav> <voice dir> <out.m4a>");

const DUR = 33.5;
/** When each voice line starts (s); matched to the scenes and word times in orbit-promo-wide.html. */
const VOICE = [1.6, 3.8, 7.7, 12.8, 19.2, 24.0, 29.8];
/** Loudness targets (LUFS): the music sits well under the voice. */
const MUSIC_LUFS = -25;
const VOICE_LUFS = -17;
const FINAL_LUFS = -15;

/** Integrated loudness of whatever the ffmpeg arguments produce. */
function lufs(args) {
  // ffmpeg writes the measurement to stderr
  const log = spawnSync("ffmpeg", [
    "-hide_banner",
    "-nostats",
    ...args,
    "-af",
    "ebur128=framelog=quiet",
    "-f",
    "null",
    "-",
  ]).stderr.toString();
  return Number(
    log
      .match(/I:\s+(-?[\d.]+) LUFS/g)
      .at(-1)
      .match(/-?[\d.]+/)[0],
  );
}
const db = (x) => Math.pow(10, x / 20).toFixed(5);

const musicGain = MUSIC_LUFS - lufs(["-i", music]);
const lineGains = VOICE.map((_, i) => VOICE_LUFS - lufs(["-i", join(voiceDir, `line${i}.mp3`)]));

const inputs = ["-i", music, ...VOICE.flatMap((_, i) => ["-i", join(voiceDir, `line${i}.mp3`)])];
const graph = [
  `[0]volume=${db(musicGain)}[m]`,
  ...VOICE.map(
    (t, i) =>
      `[${i + 1}]aresample=48000,aformat=channel_layouts=stereo,volume=${db(lineGains[i])},` +
      `adelay=${Math.round(t * 1000)}:all=1,apad=whole_dur=${DUR}[v${i}]`,
  ),
  `[m]${VOICE.map((_, i) => `[v${i}]`).join("")}amix=inputs=${VOICE.length + 1}:normalize=0`,
].join(";");

// Pass 1 measures the mix; pass 2 applies one fixed gain, a limiter only catches peaks.
const mixed = (() => {
  const log = spawnSync("ffmpeg", [
    "-hide_banner",
    "-nostats",
    ...inputs,
    "-filter_complex",
    `${graph},ebur128=framelog=quiet`,
    "-t",
    String(DUR),
    "-f",
    "null",
    "-",
  ]).stderr.toString();
  return Number(
    log
      .match(/I:\s+(-?[\d.]+) LUFS/g)
      .at(-1)
      .match(/-?[\d.]+/)[0],
  );
})();
const finalGain = FINAL_LUFS - mixed;
execFileSync(
  "ffmpeg",
  [
    "-y",
    "-loglevel",
    "error",
    ...inputs,
    "-filter_complex",
    `${graph},volume=${db(finalGain)},alimiter=limit=0.89:attack=2:release=60:level=disabled`,
    "-t",
    String(DUR),
    "-ar",
    "48000",
    "-c:a",
    "aac",
    "-b:a",
    "256k",
    out,
  ],
  { stdio: "inherit" },
);
console.log(
  `saved ${out}: music ${musicGain.toFixed(1)} dB, voice lines ${lineGains.map((g) => g.toFixed(1)).join("/")} dB, final ${finalGain.toFixed(1)} dB`,
);
