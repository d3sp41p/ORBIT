/**
 * Voice-over for the wide promo with ElevenLabs (ELEVENLABS_API_KEY in
 * .env.local). Shared-library voices are added to the account first.
 *   node promo/voice.mjs samples <outDir>          the same lines in each candidate voice
 *   node promo/voice.mjs lines <voiceKey> <outDir> line0.mp3 .. line6.mp3 for the video
 */
import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";

dotenv.config({ path: fileURLToPath(new URL("../.env.local", import.meta.url)), quiet: true });
const KEY = process.env.ELEVENLABS_API_KEY;
if (!KEY) throw new Error("ELEVENLABS_API_KEY is not set (.env.local)");
const API = "https://api.elevenlabs.io/v1";
const H = { "xi-api-key": KEY, "content-type": "application/json" };

/** Candidates from the shared library: [key, voice id, public owner id, name]. */
export const VOICES = {
  // chosen by the owner
  justin: ["DtQLDxHbTiQTpVVanTy1", "1c51ae02bb", "Justin Case - Trustworthy Ad Narrator"],
  christopher: ["jumP4YgL6qcL2qz3jaSF", "6c5e102d5e", "Christopher - Calm Confident Narrator"],
  jonathan: ["4u5cJuSmHP9d6YRolsOu", "bb9155af3b", "Jonathan - Sophisticated, Calm Narrator"],
  mark: ["7PbNGDB5sJCFnOZuMPNL", "7f377047e0", "Mark Dou - Global Modern Narrator"],
  nicole: ["i7vPmJ2yNcoEVAdpHcQa", "6cf5f2944f", "Nicole - Warm, Soft and Balanced"],
  katherine: ["NtS6nEHDYMQC9QczMQuq", "fbf310a05b", "Katherine - Calm Luxury Narrator"],
};

export const LINES = [
  "This is ORBIT.",
  "Every holder... is a world.",
  "Hold the token, and a planet is born, orbiting the coin itself.",
  "Every world lives its own story. Oceans. Life. Civilizations.",
  "Your hold writes the history, and AI reports it live.",
  "Hold, and your world grows. Sell... and catastrophe strikes.",
  "ORBIT. Every holder is a world.",
];

/** Voice chain after synthesis: presence, even level, a little room. */
export const VOICE_FX =
  "highpass=f=70,equalizer=f=250:t=q:w=1.2:g=-1.5,equalizer=f=3500:t=q:w=1.4:g=2," +
  "acompressor=threshold=-18dB:ratio=2.5:attack=5:release=120:makeup=2,aecho=0.8:0.45:40|85:0.08|0.05";

async function ownVoiceIds() {
  const r = await fetch(`${API}/voices`, { headers: H });
  const j = await r.json();
  return new Map((j.voices ?? []).map((v) => [v.name, v.voice_id]));
}

/** The account's id for a shared voice (adds it to "My Voices" once). */
async function voiceId(key) {
  const [id, owner, name] = VOICES[key];
  const own = await ownVoiceIds();
  if (own.has(name)) return own.get(name);
  const fullOwner = await findOwner(id, owner);
  const r = await fetch(`${API}/voices/add/${fullOwner}/${id}`, {
    method: "POST",
    headers: H,
    body: JSON.stringify({ new_name: name }),
  });
  const j = await r.json();
  if (!r.ok) throw new Error(`add ${name}: ${JSON.stringify(j).slice(0, 200)}`);
  return j.voice_id;
}

async function findOwner(id, prefix) {
  const u = new URL(`${API}/shared-voices`);
  u.searchParams.set("search", VOICES[Object.keys(VOICES).find((k) => VOICES[k][0] === id)][2]);
  u.searchParams.set("page_size", "20");
  const j = await (await fetch(u, { headers: H })).json();
  const v = (j.voices ?? []).find((x) => x.voice_id === id && x.public_owner_id.startsWith(prefix));
  if (!v) throw new Error(`shared voice ${id} not found`);
  return v.public_owner_id;
}

async function speak(voice, text, file, model = "eleven_multilingual_v2") {
  const r = await fetch(`${API}/text-to-speech/${voice}?output_format=mp3_44100_128`, {
    method: "POST",
    headers: H,
    body: JSON.stringify({
      text,
      model_id: model,
      // Calm, even delivery for an exhibition audience: steady, little drama, a touch slower.
      voice_settings: {
        stability: 0.6,
        similarity_boost: 0.8,
        style: 0.12,
        use_speaker_boost: true,
        speed: 0.95,
      },
    }),
  });
  if (!r.ok) throw new Error(`tts ${r.status}: ${(await r.text()).slice(0, 200)}`);
  const raw = file.replace(/\.mp3$/, "-raw.mp3");
  writeFileSync(raw, Buffer.from(await r.arrayBuffer()));
  execFileSync("ffmpeg", [
    "-y",
    "-loglevel",
    "error",
    "-i",
    raw,
    "-af",
    VOICE_FX,
    "-ar",
    "48000",
    "-b:a",
    "192k",
    file,
  ]);
  execFileSync(
    process.platform === "win32" ? "cmd" : "rm",
    process.platform === "win32" ? ["/c", "del", raw.replace(/\//g, "\\")] : [raw],
  );
}

/** Remove voices this script added earlier (by name) to free the account's voice slots. */
async function removeVoices(names) {
  const own = await ownVoiceIds();
  for (const n of names)
    if (own.has(n)) {
      await fetch(`${API}/voices/${own.get(n)}`, { method: "DELETE", headers: H });
      console.log(`removed ${n}`);
    }
}

const [cmd, a, b] = process.argv.slice(2);
if (cmd === "remove") {
  await removeVoices(process.argv.slice(3));
  process.exit(0);
}
if (cmd === "samples") {
  mkdirSync(a, { recursive: true });
  const text = `${LINES[0]} ${LINES[1]} ${LINES[2]}`;
  for (const [i, key] of Object.keys(VOICES).entries()) {
    const id = await voiceId(key);
    await speak(id, text, join(a, `eleven-${i + 1}-${key}.mp3`));
    console.log(`eleven-${i + 1}-${key}.mp3`);
  }
} else if (cmd === "lines") {
  mkdirSync(b, { recursive: true });
  const id = await voiceId(a);
  for (const [i, line] of LINES.entries()) {
    await speak(id, line, join(b, `line${i}.mp3`));
    console.log(`line${i}.mp3  ${line}`);
  }
} else throw new Error("usage: node promo/voice.mjs samples <dir> | lines <voice> <dir>");
