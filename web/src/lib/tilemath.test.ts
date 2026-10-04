import { describe, expect, it } from 'vitest';
import { countTilesInBbox, lonLatToTile, tileKey, tilesInBbox } from './tilemath';

describe('lonLatToTile', () => {
  it('just south-east of the origin is tile 1/1 at zoom 1', () => {
    expect(lonLatToTile(0.001, -0.001, 1)).toEqual([1, 1]);
  });

  it('clamps the east edge to the last tile', () => {
    expect(lonLatToTile(180, 0, 3)).toEqual([7, 4]);
  });
});

describe('tilesInBbox', () => {
  it('returns one tile per zoom for a point bbox', () => {
    expect(tilesInBbox([139.06, 36.39, 139.06, 36.39], 10, 12).map((t) => t[0])).toEqual([10, 11, 12]);
  });

  it('has the same length as countTilesInBbox', () => {
    const bbox: [number, number, number, number] = [138.9, 36.4, 139.1, 36.6];
    expect(tilesInBbox(bbox, 4, 14)).toHaveLength(countTilesInBbox(bbox, 4, 14));
  });

  it('rejects an inverted bbox', () => {
    expect(() => tilesInBbox([139.1, 36.4, 138.9, 36.6], 12, 12)).toThrow();
  });
});

describe('countTilesInBbox', () => {
  it('a 10 km square up to z16 stays within a day-trip budget (<1500 tiles)', () => {
    // ~0.09° lat × ~0.11° lon ≈ 10 km × 10 km at 36°N
    expect(countTilesInBbox([138.9, 36.5, 139.01, 36.59], 4, 16)).toBeLessThan(1500);
  });
});

describe('tileKey', () => {
  it('formats z/x/y', () => {
    expect(tileKey(14, 1, 2)).toBe('14/1/2');
  });
});
