/**
 * GSI optimal vector tiles (標準地図風, includes contour lines) with an offline tile store.
 *
 * Tiles are requested through the custom protocol "gsibv://z/x/y": the IndexedDB copy is used
 * when present (offline), otherwise the tile is read from GSI's public PMTiles by HTTP range.
 */
import { addProtocol, type StyleSpecification } from 'maplibre-gl';
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

let remote: PMTiles | null = null;
function remoteArchive(): PMTiles {
  remote ??= new PMTiles(GSI_PMTILES);
  return remote;
}

function parseTileUrl(url: string): [number, number, number] {
  const m = /^gsibv:\/\/(\d+)\/(\d+)\/(\d+)/.exec(url);
  if (!m) throw new Error(`bad base-map tile url: ${url}`);
  return [Number(m[1]), Number(m[2]), Number(m[3])];
}

const EMPTY_TILE = new ArrayBuffer(0);

export function registerBasemapProtocol(): void {
  addProtocol(PROTOCOL, async (params, abortController) => {
    const [z, x, y] = parseTileUrl(params.url);
    const stored = await dbGet<ArrayBuffer>(STORES.tiles, tileKey(z, x, y));
    if (stored) return { data: stored };
    if (!navigator.onLine) return { data: EMPTY_TILE };
    const res = await remoteArchive().getZxy(z, x, y, abortController.signal);
    return { data: res?.data ?? EMPTY_TILE };
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
  const tiles = countTilesInBbox(bbox, BASE_MIN_ZOOM, maxZoom);
  return { tiles, bytes: tiles * EST_BYTES_PER_TILE };
}

export interface DownloadProgress {
  done: number;
  total: number;
  bytes: number;
}

/** Store every base-map tile of `bbox` (z4..maxZoom) in IndexedDB. Already stored tiles are skipped. */
export async function downloadBaseArea(
  bbox: BBox,
  maxZoom: number,
  onProgress: (p: DownloadProgress) => void,
  signal: AbortSignal,
): Promise<DownloadProgress> {
  const tiles = tilesInBbox(bbox, BASE_MIN_ZOOM, Math.min(maxZoom, BASE_MAX_ZOOM));
  if (tiles.length > MAX_TILES_PER_AREA) {
    throw new Error(`範囲が広すぎます（${tiles.length} 枚 > 上限 ${MAX_TILES_PER_AREA} 枚）`);
  }
  const progress: DownloadProgress = { done: 0, total: tiles.length, bytes: 0 };
  let pending: [string, unknown][] = [];
  let next = 0;

  const flush = async (): Promise<void> => {
    const batch = pending;
    pending = [];
    await dbPutMany(STORES.tiles, batch);
  };

  const worker = async (): Promise<void> => {
    while (next < tiles.length) {
      if (signal.aborted) throw new DOMException('download cancelled', 'AbortError');
      const [z, x, y] = tiles[next++];
      const key = tileKey(z, x, y);
      if (!(await dbHasKey(STORES.tiles, key))) {
        const res = await remoteArchive().getZxy(z, x, y, signal);
        const data = res?.data ?? EMPTY_TILE;
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
