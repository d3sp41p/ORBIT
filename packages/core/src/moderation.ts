// The word lists ship no types; apps that compile this file need the declaration too.
// eslint-disable-next-line @typescript-eslint/triple-slash-reference
/// <reference path="./naughty-words.d.ts" />
/**
 * Server-side check of owner customisation (spec: "Wallet and planet
 * settings"). Allowed: Latin letters, digits, space, hyphen, apostrophe
 * (the motto also takes punctuation); no links or emoji; no profanity or
 * insults in several languages, including tricks with digits and spaces.
 * Server only: the word lists are large (import "@orbit/core/moderation").
 */
import naughty from "naughty-words";
import { DataSet, englishDataset, englishRecommendedTransformers, RegExpMatcher } from "obscenity";
import { CUSTOM_FIELDS, CUSTOM_MAX, type CustomField, type CustomValues } from "./custom";

/** LDNOOBW lists of languages written in Latin script (their words of 5+ letters). */
const LANGS = [
  "en",
  "de",
  "es",
  "fr",
  "it",
  "pt",
  "nl",
  "pl",
  "cs",
  "da",
  "fi",
  "hu",
  "no",
  "sv",
  "tr",
  "eo",
  "fil",
] as const;

/**
 * Own list: Russian and Ukrainian profanity in Latin transliteration, slurs
 * and hate symbols the public lists miss, and names that impersonate the team.
 */
const OWN = [
  "blyat",
  "blyad",
  "pizda",
  "pizdec",
  "pizdets",
  "nahuy",
  "nahui",
  "ebat",
  "yebat",
  "ebal",
  "pidor",
  "pidar",
  "pidoras",
  "mudak",
  "mudila",
  "gandon",
  "zalupa",
  "shluha",
  "shlyuha",
  "dolboeb",
  "dolboyob",
  "ueban",
  "uebok",
  "khuy",
  "hitler",
  "nazi",
  "jihad",
  "nigga",
  "nigger",
  "faggot",
  "retard",
  "tranny",
  "admin",
  "moderator",
  "official",
  "support team",
  "orbit team",
];

/**
 * Short words of other languages are often ordinary English ("con", "fan",
 * "hard"), so only these unambiguous ones are matched, as whole words.
 */
const SHORT_OTHER = [
  "chuj",
  "cipa",
  "culo",
  "dupa",
  "fasz",
  "fica",
  "fick",
  "fiut",
  "foda",
  "huj",
  "hure",
  "kaco",
  "kut",
  "puta",
  "pute",
  "szar",
  "zmrd",
  "srac",
  "zrat",
  "kurw",
  "pizd",
  "huy",
  "hui",
  "xuy",
  "suka",
  "blya",
  "eban",
  "chmo",
  "kkk",
  "heil",
  "isis",
];

const LEET: Record<string, string> = {
  "0": "o",
  "1": "i",
  "3": "e",
  "4": "a",
  "5": "s",
  "6": "g",
  "7": "t",
  "8": "b",
  "9": "g",
  "@": "a",
  $: "s",
};

const MARKS = /\p{M}/gu;
const NOT_LETTER = /[^\p{L}]/gu;
const REPEAT = /(\p{L})\1+/gu;

/** Lowercase, no accents, digits read as letters; `squeeze` folds repeats ("fuuuck"). */
function letters(s: string, squeeze: boolean): string {
  const t = s
    .normalize("NFKD")
    .replace(MARKS, "")
    .toLowerCase()
    .replace(/ß/g, "ss")
    .replace(/[0-9@$]/g, (c) => LEET[c] ?? c);
  return squeeze ? t.replace(REPEAT, "$1") : t;
}

interface WordLists {
  /** 5+ letters: a word that starts with one is blocked ("fuckface"). */
  long: string[];
  /** Short words: whole words only ("ass" must not hit "class"). */
  short: Set<string>;
}

let cache: WordLists | null = null;
function wordLists(): WordLists {
  if (cache) return cache;
  const byLang = naughty;
  const long = new Set<string>();
  const short = new Set<string>();
  // List words are taken as written: squeezing them would turn "butt" into "but".
  const add = (w: string, shortToo: boolean) => {
    const n = letters(w, false).replace(NOT_LETTER, "");
    if (n.length >= 5) long.add(n);
    else if (n.length >= 3 && shortToo) short.add(n);
  };
  for (const l of LANGS) for (const w of byLang[l] ?? []) add(w, l === "en");
  for (const w of [...OWN, ...SHORT_OTHER]) add(w, true);
  cache = { long: [...long], short };
  return cache;
}

// The library's "anal" pattern also hits names like "Analu"; the whole word
// is still blocked by the short list.
const english = new RegExpMatcher({
  ...new DataSet<{ originalWord: string }>()
    .addAll(englishDataset)
    .removePhrasesIf((p) => p.metadata?.originalWord === "anal")
    .build(),
  ...englishRecommendedTransformers,
});

/** Words of a text as written and with letters typed apart joined ("f u c k"). */
function wordsOf(norm: string): string[] {
  const words = norm.split(/[^\p{L}]+/u).filter(Boolean);
  const out = [...words];
  let run = "";
  for (const w of [...words, ""]) {
    if (w.length === 1) run += w;
    else {
      if (run.length > 1) out.push(run);
      run = "";
    }
  }
  // The whole text without spaces catches "fuck face" and "shit head".
  out.push(norm.replace(NOT_LETTER, ""));
  return out;
}

/** True when the text contains profanity, an insult or a reserved name. */
export function isOffensive(text: string): boolean {
  if (english.hasMatch(text)) return true;
  if (/1\s*4\s*8\s*8/.test(text)) return true;
  const { long, short } = wordLists();
  for (const squeeze of [false, true]) {
    for (const w of wordsOf(letters(text, squeeze))) {
      if (short.has(w)) return true;
      if (w.length >= 5 && long.some((l) => w.startsWith(l))) return true;
    }
  }
  return false;
}

const NAME_CHARS = /^[\p{Script=Latin}0-9 '’-]+$/u;
const MOTTO_CHARS = /^[\p{Script=Latin}0-9 '’.,!?:;"“”«»()&-]+$/u;
const LINK = /https?:|www\.|\.(com|net|org|io|xyz|ru|gg|me|app|fun|link|site|co)\b|\/\//i;

export type CustomCheck =
  | { ok: true; values: CustomValues }
  | { ok: false; field: CustomField; code: string; message: string };

/** Check what the owner sent. Empty fields mean "stock value". */
export function checkCustom(input: Partial<Record<CustomField, unknown>>): CustomCheck {
  const values = {} as CustomValues;
  for (const f of CUSTOM_FIELDS) {
    const raw = input[f];
    if (raw !== undefined && raw !== null && typeof raw !== "string")
      return { ok: false, field: f, code: "bad_type", message: "Must be text" };
    const v = (raw ?? "").normalize("NFC").replace(/\s+/g, " ").trim();
    if (!v) {
      values[f] = null;
      continue;
    }
    const fail = (code: string, message: string): CustomCheck => ({
      ok: false,
      field: f,
      code,
      message,
    });
    if (v.length > CUSTOM_MAX[f]) return fail("too_long", `At most ${CUSTOM_MAX[f]} characters`);
    if (!(f === "motto" ? MOTTO_CHARS : NAME_CHARS).test(v))
      return fail(
        "bad_chars",
        f === "motto"
          ? "Use Latin letters, digits, spaces and basic punctuation"
          : "Use Latin letters, digits, spaces, hyphens and apostrophes",
      );
    if (!/\p{L}/u.test(v)) return fail("no_letters", "Needs at least one letter");
    if (LINK.test(v)) return fail("link", "Links are not allowed");
    if (isOffensive(v)) return fail("offensive", "This text is not allowed");
    values[f] = v;
  }
  return { ok: true, values };
}
