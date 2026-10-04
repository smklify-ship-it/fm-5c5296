/**
 * Prefecture PMTiles (vegetation + national forest) are downloaded whole into IndexedDB once,
 * then read locally with pmtiles' FileSource. The same path works online and offline, and
 * does not depend on the host supporting HTTP range requests.
 */
import { FileSource, PMTiles, Protocol } from 'pmtiles';
import { addProtocol, type AddProtocolAction } from 'maplibre-gl';
import { dbDelete, dbGet, dbPut, STORES } from './db';
import type { PrefEntry, PrefIndex } from './types';

const protocol = new Protocol();
let registered = false;

export function registerPmtilesProtocol(): void {
  if (registered) return;
  // pmtiles types its response data as `unknown` (it serves TileJSON objects and tile bytes);
  // both are valid AddProtocolResponseData at runtime.
  addProtocol('pmtiles', protocol.tilev4 as AddProtocolAction);
  registered = true;
}

export function dataUrl(fileName: string): string {
  return new URL(`data/${fileName}`, document.baseURI).href;
}

const INDEX_KEY = 'index/prefs.json';

/**
 * Latest index from the network, or the copy kept on the device when offline. The copy is
 * kept by the app itself because the very first visit runs before the service worker is
 * active, so the SW cache cannot be relied on to have it.
 */
export async function fetchPrefIndex(): Promise<PrefIndex> {
  try {
    const res = await fetch(dataUrl('prefs.json'), { cache: 'no-cache' });
    if (!res.ok) throw new Error(`prefs.json load failed: HTTP ${res.status}`);
    const index = (await res.json()) as PrefIndex;
    await dbPut(STORES.files, INDEX_KEY, index);
    return index;
  } catch (e) {
    const saved = await dbGet<PrefIndex>(STORES.files, INDEX_KEY);
    if (saved) {
      console.warn('prefs.json unreachable; using the copy stored on this device', e);
      return saved;
    }
    throw e;
  }
}

/** Key in IndexedDB includes the build date, so a rebuilt file is never mixed with an old one. */
function storeKey(fileName: string, built: string): string {
  return `${built}/${fileName}`;
}

export async function isPrefStored(entry: PrefEntry): Promise<boolean> {
  const veg = await dbGet<Blob>(STORES.files, storeKey(entry.veg, entry.built));
  const kok = await dbGet<Blob>(STORES.files, storeKey(entry.kokuyu, entry.built));
  return veg !== undefined && kok !== undefined;
}

async function downloadBlob(
  url: string,
  expectedBytes: number,
  onBytes: (n: number) => void,
): Promise<Blob> {
  const res = await fetch(url);
  if (!res.ok || !res.body) throw new Error(`download failed: HTTP ${res.status} ${url}`);
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let received = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    received += value.byteLength;
    onBytes(received);
  }
  if (expectedBytes > 0 && received !== expectedBytes) {
    throw new Error(`incomplete download ${url}: ${received}/${expectedBytes} bytes`);
  }
  return new Blob(chunks as BlobPart[]);
}

export async function storePref(
  entry: PrefEntry,
  onProgress: (received: number, total: number) => void,
): Promise<void> {
  const total = entry.vegBytes + entry.kokuyuBytes;
  const veg = await downloadBlob(dataUrl(entry.veg), entry.vegBytes, (n) => onProgress(n, total));
  const kok = await downloadBlob(dataUrl(entry.kokuyu), entry.kokuyuBytes, (n) =>
    onProgress(entry.vegBytes + n, total),
  );
  await dbPut(STORES.files, storeKey(entry.veg, entry.built), veg);
  await dbPut(STORES.files, storeKey(entry.kokuyu, entry.built), kok);
}

export async function removePref(entry: PrefEntry): Promise<void> {
  await dbDelete(STORES.files, storeKey(entry.veg, entry.built));
  await dbDelete(STORES.files, storeKey(entry.kokuyu, entry.built));
}

/** Register stored files with the pmtiles protocol; returns the MapLibre source URLs. */
export async function attachPref(entry: PrefEntry): Promise<{ veg: string; kokuyu: string }> {
  const urls: string[] = [];
  for (const name of [entry.veg, entry.kokuyu]) {
    const blob = await dbGet<Blob>(STORES.files, storeKey(name, entry.built));
    if (!blob) throw new Error(`${name} is not stored on this device`);
    const file = new File([blob], `${entry.built}-${name}`);
    protocol.add(new PMTiles(new FileSource(file)));
    urls.push(`pmtiles://${file.name}`);
  }
  return { veg: urls[0], kokuyu: urls[1] };
}
