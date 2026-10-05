import { describe, expect, it } from 'vitest';
import { nextColor, PALETTE, UNSELECTED_COLOR, vegColor, vegFilter, visibleSelections } from './style';

const off = { enabled: false, min: 1000, max: 1600 };
const on = { enabled: true, min: 1000, max: 1600 };

describe('vegFilter', () => {
  it('returns null when nothing is selected (layer hidden)', () => {
    expect(vegFilter([], off)).toBeNull();
  });

  it('filters by selected codes only when elevation is off', () => {
    expect(vegFilter([{ code: 1, color: '#000' }], off)).toEqual(['in', ['get', 'c'], ['literal', [1]]]);
  });

  it('adds an overlap test against [lo, hi] when elevation is on', () => {
    expect(vegFilter([{ code: 1, color: '#000' }], on)).toEqual([
      'all',
      ['in', ['get', 'c'], ['literal', [1]]],
      ['>=', ['coalesce', ['get', 'hi'], 1600], 1000],
      ['<=', ['coalesce', ['get', 'lo'], 1000], 1600],
    ]);
  });

  it('leaves hidden selections out of the filter', () => {
    const selected = [
      { code: 1, color: '#000' },
      { code: 2, color: '#111', hidden: true },
    ];
    expect(vegFilter(selected, off)).toEqual(['in', ['get', 'c'], ['literal', [1]]]);
  });

  it('returns null when every selection is hidden (layer hidden)', () => {
    expect(vegFilter([{ code: 1, color: '#000', hidden: true }], off)).toBeNull();
  });
});

describe('visibleSelections', () => {
  it('treats a selection without the hidden flag (older saved data) as visible', () => {
    expect(visibleSelections([{ code: 1, color: '#000' }])).toHaveLength(1);
  });
});

describe('nextColor with hidden selections', () => {
  it('does not reuse the colour of a hidden selection', () => {
    expect(nextColor([{ code: 1, color: PALETTE[0], hidden: true }])).toBe(PALETTE[1]);
  });
});

describe('vegColor', () => {
  it('is the unselected grey when nothing is selected', () => {
    expect(vegColor([])).toBe(UNSELECTED_COLOR);
  });

  it('maps each code to its colour with a grey fallback', () => {
    expect(vegColor([{ code: 7, color: '#111' }])).toEqual(['match', ['get', 'c'], 7, '#111', UNSELECTED_COLOR]);
  });
});

describe('nextColor', () => {
  it('starts with the first palette colour', () => {
    expect(nextColor([])).toBe(PALETTE[0]);
  });

  it('reuses a colour freed by removing a selection', () => {
    expect(nextColor([{ code: 1, color: PALETTE[1] }])).toBe(PALETTE[0]);
  });
});
