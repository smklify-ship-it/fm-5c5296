import { describe, expect, it } from 'vitest';
import { aspectDeg, cellSizeM, decodeHeights, maskPixels, sectorOf, smoothHeights } from './aspect';

const ALL = [true, true, true, true, true, true, true, true];
const only = (i: number) => ALL.map((_, j) => j === i);
const N = 0;
const E = 2;
const S = 4;

/** 5×5 tile; heights from a function of (column, row); row grows southwards. */
function tile(f: (c: number, r: number) => number): Float64Array {
  const h = new Float64Array(25);
  for (let r = 0; r < 5; r++) for (let c = 0; c < 5; c++) h[r * 5 + c] = f(c, r);
  return h;
}
const centreAlpha = (mask: Uint8ClampedArray) => mask[(2 * 5 + 2) * 4 + 3];

describe('aspectDeg / sectorOf', () => {
  it('a slope rising to the north faces south', () => {
    expect(sectorOf(aspectDeg(0, 1))).toBe(S);
  });

  it('a slope rising to the west faces east', () => {
    expect(sectorOf(aspectDeg(-1, 0))).toBe(E);
  });

  it('north covers both sides of 0°', () => {
    expect([sectorOf(350), sectorOf(10)]).toEqual([N, N]);
  });
});

describe('maskPixels', () => {
  // Rises 10 m per 10 m pixel towards the north (45°), so the slope faces south.
  const southFacing = tile((_, r) => 1000 - r * 10);

  it('greys a south-facing slope when only north is allowed', () => {
    expect(centreAlpha(maskPixels(southFacing, 5, 5, 10, only(N), null))).toBeGreaterThan(0);
  });

  it('keeps a south-facing slope when south is allowed', () => {
    expect(centreAlpha(maskPixels(southFacing, 5, 5, 10, only(S), null))).toBe(0);
  });

  it('never greys flat ground', () => {
    const flat = tile((_, r) => 1000 - r * 0.1); // ~0.6°
    expect(centreAlpha(maskPixels(flat, 5, 5, 10, only(N), null))).toBe(0);
  });

  it('leaves ground outside the elevation band to the elevation mask', () => {
    expect(centreAlpha(maskPixels(southFacing, 5, 5, 10, only(N), [0, 500]))).toBe(0);
  });

  it('greys a wrong-facing slope inside the elevation band', () => {
    expect(centreAlpha(maskPixels(southFacing, 5, 5, 10, only(N), [900, 1100]))).toBeGreaterThan(0);
  });

  it('skips pixels without elevation data', () => {
    const holes = tile(() => Number.NaN);
    expect(centreAlpha(maskPixels(holes, 5, 5, 10, only(N), null))).toBe(0);
  });
});

describe('decodeHeights', () => {
  it('decodes GSI elevation and the no-data value', () => {
    const rgba = new Uint8ClampedArray([1, 0, 0, 255, 128, 0, 0, 255]);
    const h = decodeHeights(rgba, 2, 1);
    expect([h[0], Number.isNaN(h[1])]).toEqual([655.36, true]);
  });
});

describe('cellSizeM', () => {
  it('is about 15 m per pixel at zoom 13 near 36.5°N', () => {
    // Tile row 3217 at z13 ≈ 36.5°N.
    expect(Math.round(cellSizeM(13, 3217))).toBe(15);
  });
});

describe('smoothHeights', () => {
  it('averages the neighbourhood', () => {
    const h = new Float64Array([0, 0, 0, 0, 9, 0, 0, 0, 0]);
    expect(smoothHeights(h, 3, 3, 1)[4]).toBe(1);
  });

  it('ignores missing values in the average', () => {
    const h = new Float64Array([Number.NaN, 2, 4]);
    expect(smoothHeights(h, 3, 1, 1)[1]).toBe(3);
  });

  it('removes a one-pixel terrace so the slope direction stays put', () => {
    // A south-facing slope with a 3 m step error in one row (DEM terrace).
    const h = new Float64Array(49);
    for (let r = 0; r < 7; r++) for (let c = 0; c < 7; c++) h[r * 7 + c] = 1000 - r * 10 + (r === 3 && c === 3 ? -6 : 0);
    const only = [false, false, false, false, true, false, false, false]; // south allowed
    expect(maskPixels(h, 7, 7, 10, only, null)[(3 * 7 + 3) * 4 + 3]).toBe(0);
  });
});
