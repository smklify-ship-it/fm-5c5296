import { describe, expect, it } from 'vitest';
import { mergeLegends, normalizeKana, searchLegends } from './search';
import type { Legend, PrefEntry } from './types';

const L = (c: number, n: string, k: string, count = 1, lo: number | null = 0, hi: number | null = 0): Legend => ({
  c,
  n,
  k,
  count,
  lo,
  hi,
});

const legends: Legend[] = [
  L(410101, 'クリ－コナラ群集', 'ヤブツバキクラス域代償植生', 50),
  L(350101, 'フクオウソウ－ミズナラ群集', 'ブナクラス域代償植生', 30),
  L(350102, 'ミヤコザサ－ミズナラ群集', 'ブナクラス域代償植生', 20),
  L(240101, 'チシマザサ－ブナ群団', 'ブナクラス域自然植生', 10),
  L(450101, 'アカマツ群落', 'ヤブツバキクラス域代償植生', 5),
];

describe('normalizeKana', () => {
  it('converts hiragana to katakana', () => {
    expect(normalizeKana('みずなら')).toBe(normalizeKana('ミズナラ'));
  });

  it('drops long-vowel and dash separators', () => {
    expect(normalizeKana('クリ－コナラ')).toBe(normalizeKana('クリコナラ'));
  });

  it('folds half-width katakana', () => {
    expect(normalizeKana('ﾌﾞﾅ')).toBe(normalizeKana('ブナ'));
  });

  it('ignores voicing so サ matches ザ in compound names', () => {
    expect(normalizeKana('ミヤコザサ')).toContain(normalizeKana('ササ'));
  });
});

describe('searchLegends', () => {
  it('partial match finds every Mizunara association', () => {
    expect(searchLegends(legends, 'ミズナラ').map((l) => l.c)).toEqual([350101, 350102]);
  });

  it('hiragana query matches katakana names', () => {
    expect(searchLegends(legends, 'あかまつ').map((l) => l.c)).toEqual([450101]);
  });

  it('space-separated terms are ANDed', () => {
    expect(searchLegends(legends, 'ササ ミズナラ').map((l) => l.c)).toEqual([350102]);
  });

  it('matches the vegetation category too', () => {
    expect(searchLegends(legends, '自然植生').map((l) => l.c)).toEqual([240101]);
  });

  it('empty query returns nothing', () => {
    expect(searchLegends(legends, '  ')).toEqual([]);
  });
});

describe('mergeLegends', () => {
  const pref = (key: string, ls: Legend[]): PrefEntry => ({
    key,
    name: key,
    bbox: [0, 0, 1, 1],
    veg: '',
    vegBytes: 0,
    kokuyu: '',
    kokuyuBytes: 0,
    built: '',
    legends: ls,
  });

  it('sums counts of the same legend across prefectures', () => {
    const merged = mergeLegends([pref('a', [L(1, 'x', 'k', 3, 100, 200)]), pref('b', [L(1, 'x', 'k', 4, 50, 150)])]);
    expect(merged[0].count).toBe(7);
  });

  it('widens the elevation range across prefectures', () => {
    const merged = mergeLegends([pref('a', [L(1, 'x', 'k', 3, 100, 200)]), pref('b', [L(1, 'x', 'k', 4, 50, 150)])]);
    expect([merged[0].lo, merged[0].hi]).toEqual([50, 200]);
  });

  it('keeps a known elevation when the other prefecture has none', () => {
    const merged = mergeLegends([pref('a', [L(1, 'x', 'k', 1, null, null)]), pref('b', [L(1, 'x', 'k', 1, 300, 400)])]);
    expect([merged[0].lo, merged[0].hi]).toEqual([300, 400]);
  });

  it('sorts by polygon count descending', () => {
    const merged = mergeLegends([pref('a', [L(1, 'x', 'k', 1), L(2, 'y', 'k', 9)])]);
    expect(merged.map((l) => l.c)).toEqual([2, 1]);
  });
});
