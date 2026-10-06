/**
 * Slope-aspect mask: greys out slopes facing directions the user did not choose.
 *
 * Computed on the device from the same GSI elevation tiles as the elevation mask (saved for
 * offline use), as a raster layer served by the custom protocol "gsiaspect://z/x/y?v=N".
 * When the elevation mask is on, this layer only greys pixels that are *inside* the band, so
 * the two masks together read as "hidden if either condition fails" without double shading.
 */
import { addProtocol } from 'maplibre-gl';
import { loadDemTile } from './basemap';

/** 8 compass sectors, clockwise from north. Index = sector number. */
export const DIRECTIONS = ['北', '北東', '東', '南東', '南', '南西', '西', '北西'] as const;

// Same look as the elevation mask (style.ts ELEV_MASK_COLOR = rgba(40,40,40,0.55)).
const MASK_RGBA = [40, 40, 40, 140] as const;
// Below this slope the facing direction is meaningless (flat ground, valley floors): never hidden.
export const FLAT_DEG = 5;
const EARTH_CIRCUMFERENCE_M = 40_075_016.686;
const TILE = 256;

export interface AspectOptions {
  enabled: boolean;
  allowed: boolean[]; // 8 entries, DIRECTIONS order
  band: [number, number] | null; // grey only inside this elevation band (elevation mask on)
}

// ---------------------------------------------------------------- pure (tested)

/** GSI dem_png RGBA → metres; NaN where no data. https://maps.gsi.go.jp/development/demtile.html */
export function decodeHeights(rgba: Uint8ClampedArray, width: number, height: number): Float64Array {
  const out = new Float64Array(width * height);
  for (let i = 0; i < width * height; i++) {
    const x = rgba[i * 4] * 65536 + rgba[i * 4 + 1] * 256 + rgba[i * 4 + 2];
    out[i] = x === 2 ** 23 ? Number.NaN : (x > 2 ** 23 ? x - 2 ** 24 : x) * 0.01;
  }
  return out;
}

/** Ground size of one pixel (m) at web-mercator tile row `y` of zoom `z`. */
export function cellSizeM(z: number, y: number): number {
  const n = Math.PI - (2 * Math.PI * (y + 0.5)) / 2 ** z;
  const lat = Math.atan(Math.sinh(n));
  return (EARTH_CIRCUMFERENCE_M * Math.cos(lat)) / (TILE * 2 ** z);
}

/** Azimuth (deg, clockwise from north) the slope faces, i.e. the downhill direction. */
export function aspectDeg(dzEast: number, dzNorth: number): number {
  const deg = (Math.atan2(-dzEast, -dzNorth) * 180) / Math.PI;
  return (deg + 360) % 360;
}

/** Sector index 0–7 for an azimuth (north = 337.5°–22.5°). */
export function sectorOf(deg: number): number {
  return Math.floor(((deg + 22.5) % 360) / 45);
}

// GSI DEM10B is interpolated from contour lines and carries small terraces; a 1-pixel (~15 m)
// gradient picks those up and the mask turns into noisy stripes (seen on Mt. Akagi). Heights
// are therefore box-smoothed over SMOOTH_RADIUS and the gradient spans ±GRADIENT_STEP pixels
// (~60 m), which keeps ridge/valley-scale slope directions.
const SMOOTH_RADIUS = 1;
const GRADIENT_STEP = 2;

/** Box mean over (2r+1)² pixels, ignoring missing values (NaN stays NaN only if all are). */
export function smoothHeights(heights: Float64Array, width: number, height: number, r: number): Float64Array {
  const out = new Float64Array(width * height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let sum = 0;
      let n = 0;
      for (let dy = -r; dy <= r; dy++) {
        const yy = y + dy;
        if (yy < 0 || yy >= height) continue;
        for (let dx = -r; dx <= r; dx++) {
          const xx = x + dx;
          if (xx < 0 || xx >= width) continue;
          const v = heights[yy * width + xx];
          if (Number.isNaN(v)) continue;
          sum += v;
          n++;
        }
      }
      out[y * width + x] = n > 0 ? sum / n : Number.NaN;
    }
  }
  return out;
}

/**
 * RGBA mask: grey where the slope is steeper than FLAT_DEG, faces a direction not allowed,
 * and (if a band is given) the ground lies inside the band. The band test uses the raw
 * height (matching the elevation mask); direction and steepness use smoothed heights.
 */
export function maskPixels(
  heights: Float64Array,
  width: number,
  height: number,
  cellM: number,
  allowed: boolean[],
  band: [number, number] | null,
): Uint8ClampedArray<ArrayBuffer> {
  const out = new Uint8ClampedArray(width * height * 4);
  const smooth = smoothHeights(heights, width, height, SMOOTH_RADIUS);
  const h = (c: number, r: number) =>
    smooth[Math.min(height - 1, Math.max(0, r)) * width + Math.min(width - 1, Math.max(0, c))];
  const flatTan = Math.tan((FLAT_DEG * Math.PI) / 180);
  for (let r = 0; r < height; r++) {
    for (let c = 0; c < width; c++) {
      const z = heights[r * width + c];
      if (Number.isNaN(z)) continue;
      if (band && (z < band[0] || z > band[1])) continue; // the elevation mask covers it
      // Clamp the stencil at the tile edge (one-sided there).
      const cl = Math.max(0, c - GRADIENT_STEP);
      const cr = Math.min(width - 1, c + GRADIENT_STEP);
      const ru = Math.max(0, r - GRADIENT_STEP);
      const rd = Math.min(height - 1, r + GRADIENT_STEP);
      const dzEast = (h(cr, r) - h(cl, r)) / ((cr - cl) * cellM);
      const dzNorth = (h(c, ru) - h(c, rd)) / ((rd - ru) * cellM); // row grows southwards
      if (!Number.isFinite(dzEast) || !Number.isFinite(dzNorth)) continue;
      if (Math.hypot(dzEast, dzNorth) < flatTan) continue;
      if (allowed[sectorOf(aspectDeg(dzEast, dzNorth))]) continue;
      out.set(MASK_RGBA, (r * width + c) * 4);
    }
  }
  return out;
}

// ---------------------------------------------------------------- map wiring

let options: AspectOptions = { enabled: false, allowed: DIRECTIONS.map(() => true), band: null };
let version = 0;

/** Store the options and return the tile URL to set, so changed options re-render the tiles. */
export function setAspectOptions(next: AspectOptions): string {
  options = next;
  version += 1;
  return `gsiaspect://{z}/{x}/{y}?v=${version}`;
}

function canvas2d(w: number, h: number): {
  ctx: OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D;
  toPng: () => Promise<Blob>;
} {
  if (typeof OffscreenCanvas !== 'undefined') {
    const c = new OffscreenCanvas(w, h);
    const ctx = c.getContext('2d');
    if (!ctx) throw new Error('2D canvas unavailable');
    return { ctx, toPng: () => c.convertToBlob({ type: 'image/png' }) };
  }
  // iOS < 16.4 has no OffscreenCanvas.
  const c = Object.assign(document.createElement('canvas'), { width: w, height: h });
  const ctx = c.getContext('2d');
  if (!ctx) throw new Error('2D canvas unavailable');
  return {
    ctx,
    toPng: () =>
      new Promise((res, rej) => c.toBlob((b) => (b ? res(b) : rej(new Error('toBlob failed'))), 'image/png')),
  };
}

let emptyPng: Promise<ArrayBuffer> | null = null;
async function transparentTile(): Promise<ArrayBuffer> {
  emptyPng ??= (async () => (await canvas2d(TILE, TILE).toPng()).arrayBuffer())();
  return (await emptyPng).slice(0); // fresh copy: MapLibre transfers (detaches) tile buffers
}

export function registerAspectProtocol(): void {
  addProtocol('gsiaspect', async (params, abortController) => {
    const m = /^gsiaspect:\/\/(\d+)\/(\d+)\/(\d+)/.exec(params.url);
    if (!m) throw new Error(`bad aspect tile url: ${params.url}`);
    const [z, x, y] = [Number(m[1]), Number(m[2]), Number(m[3])];
    if (!options.enabled) return { data: await transparentTile() };
    const png = await loadDemTile(z, x, y, abortController.signal);
    const bitmap = await createImageBitmap(new Blob([png]));
    const { ctx, toPng } = canvas2d(bitmap.width, bitmap.height);
    ctx.drawImage(bitmap, 0, 0);
    const src = ctx.getImageData(0, 0, bitmap.width, bitmap.height);
    const heights = decodeHeights(src.data, src.width, src.height);
    const mask = maskPixels(heights, src.width, src.height, cellSizeM(z, y), options.allowed, options.band);
    ctx.putImageData(new ImageData(mask, src.width, src.height), 0, 0);
    return { data: await (await toPng()).arrayBuffer() };
  });
}
