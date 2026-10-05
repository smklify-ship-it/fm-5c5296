import { describe, expect, it } from 'vitest';
import { colorsFromPatternId, MAX_STRIPES, patternPixels } from './patterns';

const pixel = (img: ReturnType<typeof patternPixels>, x: number, y: number) =>
  [...img.data.slice((y * img.width + x) * 4, (y * img.width + x) * 4 + 3)].join(',');

describe('colorsFromPatternId', () => {
  it('reads the colours in order', () => {
    expect(colorsFromPatternId('vm|g1#e6194b|i220110#4363d8')).toEqual(['#e6194b', '#4363d8']);
  });

  it('ignores the empty prefix-only id', () => {
    expect(colorsFromPatternId('vm')).toEqual([]);
  });
});

describe('patternPixels', () => {
  it('is a solid tile for one colour', () => {
    const img = patternPixels(['#ff0000']);
    const colours = new Set(Array.from({ length: img.width * img.height }, (_, i) => pixel(img, i % img.width, Math.floor(i / img.width))));
    expect([...colours]).toEqual(['255,0,0']);
  });

  it('uses every colour for stripes', () => {
    const img = patternPixels(['#ff0000', '#0000ff']);
    const colours = new Set(Array.from({ length: img.width * img.height }, (_, i) => pixel(img, i % img.width, Math.floor(i / img.width))));
    expect([...colours].sort()).toEqual(['0,0,255', '255,0,0']);
  });

  it('repeats seamlessly across the tile edge (diagonal continues)', () => {
    const img = patternPixels(['#ff0000', '#0000ff']);
    // Moving one pixel right equals moving one pixel down on a diagonal stripe pattern.
    expect(pixel(img, img.width - 1, 0)).toBe(pixel(img, 0, img.height - 1));
  });

  it(`draws at most ${MAX_STRIPES} colours`, () => {
    const many = ['#110000', '#220000', '#330000', '#440000', '#550000'];
    const img = patternPixels(many);
    const colours = new Set(Array.from({ length: img.width * img.height }, (_, i) => pixel(img, i % img.width, Math.floor(i / img.width))));
    expect(colours.size).toBe(MAX_STRIPES);
  });

  it('rejects an empty colour list', () => {
    expect(() => patternPixels([])).toThrow();
  });
});
