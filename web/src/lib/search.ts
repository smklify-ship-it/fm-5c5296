import type { Legend, PrefEntry } from './types';

const HIRAGANA_START = 0x3041;
const HIRAGANA_END = 0x3096;
const KANA_OFFSET = 0x60;
// Legend names mix ー/－/-/・ freely; users rarely type them, so they are ignored.
const IGNORED_CHARS = /[\s\-－ー―‐・･（）()]/g;

// Compound names voice their second part (ササ → ミヤコザサ, ナラ → コナラ is fine but
// サクラ → ヤマザクラ is not), so dakuten/handakuten are ignored when matching.
const VOICING_MARKS = /[゙゚]/g;

/** Fold width, hiragana→katakana, voicing and separators so "ささ" matches "ミヤコザサ". */
export function normalizeKana(text: string): string {
  const folded = text.normalize('NFKC').normalize('NFD').replace(VOICING_MARKS, '');
  let out = '';
  for (const ch of folded) {
    const code = ch.codePointAt(0) ?? 0;
    out +=
      code >= HIRAGANA_START && code <= HIRAGANA_END
        ? String.fromCodePoint(code + KANA_OFFSET)
        : ch;
  }
  return out.replace(IGNORED_CHARS, '').toLowerCase();
}

/** Same legend code in several prefectures becomes one entry (counts summed, range widened). */
export function mergeLegends(prefs: PrefEntry[]): Legend[] {
  const byCode = new Map<number, Legend>();
  for (const pref of prefs) {
    for (const legend of pref.legends) {
      const seen = byCode.get(legend.c);
      if (!seen) {
        byCode.set(legend.c, { ...legend });
        continue;
      }
      seen.count += legend.count;
      seen.lo = minNullable(seen.lo, legend.lo);
      seen.hi = maxNullable(seen.hi, legend.hi);
    }
  }
  return [...byCode.values()].sort((a, b) => b.count - a.count || a.c - b.c);
}

function minNullable(a: number | null, b: number | null): number | null {
  if (a === null) return b;
  if (b === null) return a;
  return Math.min(a, b);
}

function maxNullable(a: number | null, b: number | null): number | null {
  if (a === null) return b;
  if (b === null) return a;
  return Math.max(a, b);
}

/** Space-separated terms are ANDed; each must appear in the name or the category. */
export function searchLegends(legends: Legend[], query: string): Legend[] {
  const terms = query
    .split(/[\s\u3000]+/)
    .map(normalizeKana)
    .filter((t) => t.length > 0);
  if (terms.length === 0) return [];
  return legends.filter((legend) => {
    const haystack = normalizeKana(legend.n) + '|' + normalizeKana(legend.k);
    return terms.every((t) => haystack.includes(t));
  });
}
