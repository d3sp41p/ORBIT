/**
 * Owner customisation of a planet (spec: "Wallet and planet settings"):
 * the four fields and how custom names replace the stock ones everywhere
 * (map, search, card, every news text old or new, chronicle).
 * Validation with the word lists lives in ./moderation (server only).
 */
import type { Bible } from "./sim";
import { W } from "./words";

export const CUSTOM_FIELDS = ["name", "species", "capital", "motto"] as const;
export type CustomField = (typeof CUSTOM_FIELDS)[number];
export type CustomValues = Record<CustomField, string | null>;

export const CUSTOM_MAX: Record<CustomField, number> = {
  name: 24,
  species: 24,
  capital: 24,
  motto: 60,
};

export const emptyCustom = (): CustomValues => ({
  name: null,
  species: null,
  capital: null,
  motto: null,
});

export const hasCustom = (c: Partial<CustomValues> | null | undefined) =>
  !!c && CUSTOM_FIELDS.some((f) => !!c[f]);

/** Stock values of a planet that custom ones may replace. */
export interface StockNames {
  name: string;
  species: string | null;
  capital: string | null;
  motto: string | null;
}

/** Stock values of a planet from its stock name and its bible. */
export const stockNames = (name: string, bible: Bible | null | undefined): StockNames => ({
  name,
  species: bible?.species ?? null,
  capital: bible?.capital ?? null,
  motto: bible ? (W.motto[bible.motto] ?? null) : null,
});

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * Replacement pairs, longest first. The species also gets its singular
 * ("Korrelid engineers" from "Korrelids"), as texts use both.
 */
export function namePairs(
  stock: StockNames,
  custom: Partial<CustomValues> | null,
): [string, string][] {
  if (!custom) return [];
  const pairs: [string, string][] = [];
  const add = (from: string | null, to: string | null | undefined) => {
    if (from && to && from !== to) pairs.push([from, to]);
  };
  add(stock.name, custom.name);
  add(stock.capital, custom.capital);
  add(stock.motto, custom.motto);
  if (stock.species && custom.species) {
    add(stock.species, custom.species);
    if (stock.species.endsWith("s"))
      add(stock.species.slice(0, -1), custom.species.replace(/s$/i, ""));
  }
  return pairs.sort((a, b) => b[0].length - a[0].length);
}

/**
 * Replace stock names with custom ones in a text: whole words only, in one
 * pass (a custom name that contains another stock name is left alone).
 */
export function applyNames(text: string, pairs: [string, string][]): string {
  if (!pairs.length) return text;
  const to = new Map(pairs);
  const re = new RegExp(
    `(?<![\\p{L}\\p{N}])(?:${pairs.map(([f]) => escapeRe(f)).join("|")})(?![\\p{L}\\p{N}])`,
    "gu",
  );
  return text.replace(re, (m) => to.get(m) ?? m);
}
