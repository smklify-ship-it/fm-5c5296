/**
 * Fill patterns for vegetation polygons: one colour = solid, several = diagonal stripes.
 *
 * Pattern ids are built per polygon by a style expression (see entriesPattern in style.ts) as
 * "vm|<key><#colour>|<key><#colour>…", so a new colour is a new id and stale images are never
 * reused. MapLibre asks for unknown ids through "styleimagemissing"; the image is made then.
 */
import type { Map as MlMap } from 'maplibre-gl';

export const PATTERN_PREFIX = 'vm';
export const MAX_STRIPES = 4;
// Image pixels per stripe; drawn at pixelRatio 2, so 4 CSS px — wide enough to tell colours apart.
const STRIPE_PX = 8;
const SOLID_PX = 8;
const PIXEL_RATIO = 2;

export interface PatternImage {
  width: number;
  height: number;
  data: Uint8ClampedArray;
}

/** Colours encoded in a pattern id, in drawing order. */
export function colorsFromPatternId(id: string): string[] {
  return id
    .split('|')
    .slice(1)
    .map((part) => part.slice(part.lastIndexOf('#')))
    .filter((c) => /^#[0-9a-fA-F]{6}$/.test(c));
}

function hexToRgb(hex: string): [number, number, number] {
  const v = Number.parseInt(hex.slice(1), 16);
  return [(v >> 16) & 255, (v >> 8) & 255, v & 255];
}

/**
 * RGBA pixels: a solid tile for one colour, diagonal stripes for several. The tile edge equals
 * one stripe period, so (x + y) mod period repeats seamlessly in both directions.
 */
export function patternPixels(colors: string[]): PatternImage {
  const rgb = colors.slice(0, MAX_STRIPES).map(hexToRgb);
  if (rgb.length === 0) throw new Error('pattern needs at least one colour');
  const size = rgb.length === 1 ? SOLID_PX : rgb.length * STRIPE_PX;
  const data = new Uint8ClampedArray(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const [r, g, b] = rgb[Math.floor(((x + y) % size) / STRIPE_PX) % rgb.length];
      const i = (y * size + x) * 4;
      data[i] = r;
      data[i + 1] = g;
      data[i + 2] = b;
      data[i + 3] = 255;
    }
  }
  return { width: size, height: size, data };
}

/** Create vegetation patterns on demand. Register once per map. */
export function registerPatternFactory(map: MlMap): void {
  map.on('styleimagemissing', (e: { id: string }) => {
    if (!e.id.startsWith(`${PATTERN_PREFIX}|`) || map.hasImage(e.id)) return;
    const colors = colorsFromPatternId(e.id);
    if (colors.length === 0) return;
    map.addImage(e.id, patternPixels(colors), { pixelRatio: PIXEL_RATIO });
  });
}
