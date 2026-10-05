/**
 * GSI optimal vector tiles (標準地図風, includes contour lines) with an offline tile store.
 *
 * Tiles are requested through the custom protocol "gsibv://z/x/y": the IndexedDB copy is used
 * when present (offline), otherwise the tile is read from GSI's public PMTiles by HTTP range.
 * Elevation tiles (for the band mask/highlight) follow the same pattern via "gsidem://z/x/y".
 */
import { addProtocol, type RasterDEMSourceSpecification, type StyleSpecification } from 'maplibre-gl';
import { PMTiles } from 'pmtiles';
import { dbGet, dbHasKey, dbPutMany, STORES } from './db';
import { countTilesInBbox, tileKey, tilesInBbox } from './tilemath';
import type { BBox } from './types';

export const GSI_PMTILES =
  'https://cyberjapandata.gsi.go.jp/xyz/optimal_bvmap-v1/optimal_bvmap-v1.pmtiles';
export const GSI_GLYPHS =
  'https://gsi-cyberjapan.github.io/optimal_bvmap/glyphs/{fontstack}/{range}.pbf';
const PROTOCOL = 'gsibv';
export const BASE_MIN_ZOOM = 4;
export const BASE_MAX_ZOOM = 16;

/** Shared with the service worker's runtime cache, so prefetched glyphs are served offline. */
export const GLYPH_CACHE = 'gsi-glyphs';
const FONT_STACK = 'NotoSansJP-Regular';
// Latin, punctuation, kana, CJK unified ideographs, full-width forms (~10 MB in total).
const GLYPH_RANGE_STARTS = [
  0, 256, 8192, 12288, 12544, ...Array.from({ length: 82 }, (_, i) => 19968 + i * 256), 65280,
];

const DOWNLOAD_CONCURRENCY = 4;
const WRITE_BATCH = 50;
// A typical day-trip area (10 km square, z4–16) is ~600 tiles; this caps accidental
// whole-prefecture downloads that would hammer the public GSI server.
export const MAX_TILES_PER_AREA = 15000;
// Measured average for mountain areas is lower; this keeps the size estimate on the safe side.
const EST_BYTES_PER_TILE = 25_000;

// GSI dem_png (DEM10B). z13 ≈ 15 m/pixel, the same resolution the pipeline uses for polygon
// elevations; MapLibre over-zooms it for closer views. Mountain tiles average ~100 KB
// (measured: 409 MB / 3,979 tiles), so a deeper zoom would quadruple offline storage.
const DEM_PROTOCOL = 'gsidem';
const DEM_URL = 'https://cyberjapandata.gsi.go.jp/xyz/dem_png/{z}/{x}/{y}.png';
export const DEM_MIN_ZOOM = 4;
export const DEM_MAX_ZOOM = 13;
const EST_BYTES_PER_DEM_TILE = 100_000;
// h = (R·2^16 + G·2^8 + B) · 0.01 m (https://maps.gsi.go.jp/development/demtile.html).
// The no-data value 2^23 decodes to ~83,886 m, i.e. "outside any band", so unknown terrain
// is masked rather than shown as if it were inside the band.
export const DEM_SOURCE: RasterDEMSourceSpecification = {
  type: 'raster-dem',
  tiles: [`${DEM_PROTOCOL}://{z}/{x}/{y}`],
  tileSize: 256,
  minzoom: DEM_MIN_ZOOM,
  maxzoom: DEM_MAX_ZOOM,
  encoding: 'custom',
  redFactor: 655.36,
  greenFactor: 2.56,
  blueFactor: 0.01,
  baseShift: 0,
};

function demKey(z: number, x: number, y: number): string {
  return `dem/${tileKey(z, x, y)}`;
}

let noDataPng: Promise<ArrayBuffer> | null = null;
/**
 * A 256×256 tile of GSI's no-data colour (128,0,0) for sea (HTTP 404) or offline gaps.
 * Always a fresh copy: MapLibre transfers tile buffers to its worker, which detaches them,
 * so handing out one shared buffer breaks every tile after the first.
 */
async function noDataTile(): Promise<ArrayBuffer> {
  noDataPng ??= (async () => {
    const canvas = new OffscreenCanvas(256, 256);
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('2D canvas unavailable for the elevation no-data tile');
    ctx.fillStyle = 'rgb(128,0,0)';
    ctx.fillRect(0, 0, 256, 256);
    return (await canvas.convertToBlob({ type: 'image/png' })).arrayBuffer();
  })();
  return (await noDataPng).slice(0);
}

async function fetchDemTile(z: number, x: number, y: number, signal: AbortSignal): Promise<ArrayBuffer> {
  const url = DEM_URL.replace('{z}', String(z)).replace('{x}', String(x)).replace('{y}', String(y));
  const res = await fetch(url, { signal });
  if (res.status === 404) return noDataTile();
  if (!res.ok) throw new Error(`elevation tile HTTP ${res.status}: ${url}`);
  return res.arrayBuffer();
}

let remote: PMTiles | null = null;
function remoteArchive(): PMTiles {
  remote ??= new PMTiles(GSI_PMTILES);
  return remote;
}

function parseTileUrl(url: string): [number, number, number] {
  const m = /^gsi(?:bv|dem):\/\/(\d+)\/(\d+)\/(\d+)/.exec(url);
  if (!m) throw new Error(`bad base-map tile url: ${url}`);
  return [Number(m[1]), Number(m[2]), Number(m[3])];
}

// A fresh empty buffer per tile for the same reason as noDataTile (transfer detaches it).
const emptyTile = (): ArrayBuffer => new ArrayBuffer(0);

export function registerBasemapProtocol(): void {
  addProtocol(PROTOCOL, async (params, abortController) => {
    const [z, x, y] = parseTileUrl(params.url);
    const stored = await dbGet<ArrayBuffer>(STORES.tiles, tileKey(z, x, y));
    if (stored) return { data: stored };
    if (!navigator.onLine) return { data: emptyTile() };
    const res = await remoteArchive().getZxy(z, x, y, abortController.signal);
    return { data: res?.data ?? emptyTile() };
  });
  addProtocol(DEM_PROTOCOL, async (params, abortController) => {
    const [z, x, y] = parseTileUrl(params.url);
    const stored = await dbGet<ArrayBuffer>(STORES.tiles, demKey(z, x, y));
    if (stored) return { data: stored };
    if (!navigator.onLine) return { data: await noDataTile() };
    return { data: await fetchDemTile(z, x, y, abortController.signal) };
  });
}

/** GSI style JSON with tiles routed through our protocol and the sprite served by this app. */
export async function loadBaseStyle(): Promise<StyleSpecification> {
  const url = new URL('style/base-style.json', document.baseURI).href;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`base style load failed: ${res.status} ${url}`);
  const style = (await res.json()) as StyleSpecification;
  style.sprite = new URL('style/std', document.baseURI).href;
  style.glyphs = GSI_GLYPHS;
  style.sources.v = {
    type: 'vector',
    minzoom: BASE_MIN_ZOOM,
    maxzoom: BASE_MAX_ZOOM,
    tiles: [`${PROTOCOL}://{z}/{x}/{y}`],
    attribution:
      '<a href="https://github.com/gsi-cyberjapan/optimal_bvmap" target="_blank">国土地理院最適化ベクトルタイル</a>',
  };
  return style;
}

export function estimateArea(bbox: BBox, maxZoom: number): { tiles: number; bytes: number } {
  const base = countTilesInBbox(bbox, BASE_MIN_ZOOM, maxZoom);
  const dem = countTilesInBbox(bbox, DEM_MIN_ZOOM, Math.min(maxZoom, DEM_MAX_ZOOM));
  return { tiles: base + dem, bytes: base * EST_BYTES_PER_TILE + dem * EST_BYTES_PER_DEM_TILE };
}

export interface DownloadProgress {
  done: number;
  total: number;
  bytes: number;
}

interface TileJob {
  key: string;
  load: (signal: AbortSignal) => Promise<ArrayBuffer>;
}

/**
 * Store every base-map tile (z4..maxZoom) and elevation tile (z4..13) of `bbox` in IndexedDB.
 * Already stored tiles are skipped.
 */
export async function downloadBaseArea(
  bbox: BBox,
  maxZoom: number,
  onProgress: (p: DownloadProgress) => void,
  signal: AbortSignal,
): Promise<DownloadProgress> {
  const jobs: TileJob[] = [
    ...tilesInBbox(bbox, BASE_MIN_ZOOM, Math.min(maxZoom, BASE_MAX_ZOOM)).map(([z, x, y]) => ({
      key: tileKey(z, x, y),
      load: async (s: AbortSignal) => (await remoteArchive().getZxy(z, x, y, s))?.data ?? emptyTile(),
    })),
    ...tilesInBbox(bbox, DEM_MIN_ZOOM, Math.min(maxZoom, DEM_MAX_ZOOM)).map(([z, x, y]) => ({
      key: demKey(z, x, y),
      load: (s: AbortSignal) => fetchDemTile(z, x, y, s),
    })),
  ];
  if (jobs.length > MAX_TILES_PER_AREA) {
    throw new Error(`範囲が広すぎます（${jobs.length} 枚 > 上限 ${MAX_TILES_PER_AREA} 枚）`);
  }
  const progress: DownloadProgress = { done: 0, total: jobs.length, bytes: 0 };
  let pending: [string, unknown][] = [];
  let next = 0;

  const flush = async (): Promise<void> => {
    const batch = pending;
    pending = [];
    await dbPutMany(STORES.tiles, batch);
  };

  const worker = async (): Promise<void> => {
    while (next < jobs.length) {
      if (signal.aborted) throw new DOMException('download cancelled', 'AbortError');
      const { key, load } = jobs[next++];
      if (!(await dbHasKey(STORES.tiles, key))) {
        const data = await load(signal);
        progress.bytes += data.byteLength;
        pending.push([key, data]);
        if (pending.length >= WRITE_BATCH) await flush();
      }
      progress.done++;
      onProgress({ ...progress });
    }
  };

  await Promise.all(Array.from({ length: DOWNLOAD_CONCURRENCY }, worker));
  await flush();
  await prefetchGlyphs(signal);
  return progress;
}

/** Labels need glyph PBFs; fetch the Japanese ranges once so offline maps keep their text. */
export async function prefetchGlyphs(signal: AbortSignal): Promise<void> {
  const cache = await caches.open(GLYPH_CACHE);
  for (const start of GLYPH_RANGE_STARTS) {
    const url = GSI_GLYPHS.replace('{fontstack}', FONT_STACK).replace(
      '{range}',
      `${start}-${start + 255}`,
    );
    if (await cache.match(url)) continue;
    const res = await fetch(url, { signal });
    if (res.ok) await cache.put(url, res);
  }
}
