/**
 * Matching place names across sources that spell them differently: OSM's
 * "Attukad waterfall" is Wikivoyage's "Atukkad Waterfalls", "Abbi Falls" is
 * "Abbey Falls", "Raja Seat" is "Raja's Seat". Transliterated names (Indian
 * place names especially) vary in doubled letters and vowel spellings, and
 * sources add or drop the feature word ("Falls", "Lake", "National Park").
 */
import { haversineKm, type LatLon } from "../geo.js";

/** Lower case, no diacritics or punctuation. */
function plainKey(name: string): string {
  return name
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/**
 * A spelling-tolerant key: lower case, no diacritics or punctuation, "'s"
 * dropped, parenthesised asides removed, doubled letters collapsed and common
 * transliteration variants folded (th→t, ee/ey→i, oo→u, w→v, y→i).
 */
export function nameKey(name: string): string {
  return name
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/\([^)]*\)/g, " ")
    .replace(/['’]s\b/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/(th|dh|bh|kh|gh|ph|sh|ch)/g, (m) => (m === "ph" ? "f" : m === "sh" || m === "ch" ? m : m[0]!))
    .replace(/ee|ey|ie/g, "i")
    .replace(/oo|ou/g, "u")
    .replace(/aa/g, "a")
    .replace(/w/g, "v")
    .replace(/y/g, "i")
    .replace(/([a-z])\1+/g, "$1")
    .replace(/\s+/g, " ")
    .trim();
}

/** Words that name the kind of feature rather than the feature. */
const FEATURE_WORDS = new Set(
  [
    "the", "of", "and", "falls", "fall", "waterfalls", "waterfall", "water", "lake", "dam", "reservoir", "temple",
    "church", "peak", "hill", "hills", "national", "park", "wildlife", "sanctuary", "reserve", "view", "viewpoint",
    "point", "museum", "garden", "gardens", "fort", "palace", "beach", "cave", "caves", "camp", "estate", "forest",
    "tower", "monastery", "shrine", "mosque", "bridge", "square", "top", "station", "castle", "cathedral",
  ].map(nameKey),
);

/** The distinctive part of a name: "Atukkad Waterfalls" → "atukad". Falls back to the whole key. */
export function coreKey(name: string): string {
  const key = nameKey(name);
  const words = key.split(" ").filter((w) => !FEATURE_WORDS.has(w));
  return words.length > 0 ? words.join(" ") : key;
}

export function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(prev[j]! + 1, cur[j - 1]! + 1, prev[j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    prev = cur;
  }
  return prev[b.length]!;
}

export interface MatchKeys {
  key: string;
  core: string;
}

export const matchKeys = (name: string): MatchKeys => ({ key: nameKey(name), core: coreKey(name) });

/** Same place name across sources, allowing a small typo budget for longer names. */
export function keysMatch(a: MatchKeys, b: MatchKeys): boolean {
  if (a.key === b.key) return true;
  const ca = a.core;
  const cb = b.core;
  if (ca === cb) return ca.length >= 3;
  const close = (x: string, y: string) => {
    const shorter = Math.min(x.length, y.length);
    return shorter >= 5 && Math.abs(x.length - y.length) <= 2 && levenshtein(x, y) <= (shorter >= 9 ? 2 : 1);
  };
  // Typos in the distinctive part, or in a feature word ("Bird Santuary").
  if (close(ca, cb) || (ca.length >= 5 && close(a.key, b.key))) return true;
  // "Nisargadhama" and "Kaveri Nisargadhama": one name adds a single word to the other.
  const [s, l] = ca.length <= cb.length ? [ca, cb] : [cb, ca];
  if (s.length < 6 || !(l.startsWith(`${s} `) || l.endsWith(` ${s}`))) return false;
  return l.split(" ").length - s.split(" ").length === 1;
}

export const namesMatch = (a: string, b: string): boolean => keysMatch(matchKeys(a), matchKeys(b));

/** Names that say what a thing is but not which one ("Photo Point", "Check Dam", "Falls 10m"). */
export function isGenericName(name: string): boolean {
  const key = plainKey(name);
  if (/^(view|photo|selfie|tourist)? ?(point|view ?point|spot)$/.test(key)) return true;
  if (/^(check )?dam( \d+)?$/.test(key)) return true;
  if (/^(water ?)?falls?( \d+ ?m)?$/.test(key)) return true;
  return /^(milestone|park|garden|temple|church|mosque|lake|pond|peak|tower|monument|memorial|statue|view)$/.test(key);
}

/**
 * Keeps one of each group of items that share a name within `km` of each
 * other (OSM often maps a viewpoint and the park around it, or the same
 * "Photo Point" three times). The first item of a group wins, so sort by
 * preference first. `km` can depend on the pair: a national park's centre is
 * far from its entrance.
 */
export function dedupeByName<T extends LatLon & { name: string }>(
  items: readonly T[],
  km: number | ((a: T, b: T) => number) = 2,
): T[] {
  const kept: Array<{ item: T; keys: MatchKeys }> = [];
  for (const item of items) {
    const keys = matchKeys(item.name);
    const limit = (k: T) => (typeof km === "number" ? km : km(k, item));
    if (kept.some((k) => keysMatch(k.keys, keys) && haversineKm(k.item, item) <= limit(k.item))) continue;
    kept.push({ item, keys });
  }
  return kept.map((k) => k.item);
}
