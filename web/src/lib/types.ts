/** [west, south, east, north] in degrees. */
export type BBox = [number, number, number, number];

/** One vegetation legend (凡例) as written by pipeline/vegmap/build.py. */
export interface Legend {
  c: number; // 凡例コード
  n: string; // 凡例名
  k: string; // 植生区分
  count: number;
  lo: number | null; // lowest elevation (m) of any polygon with this legend
  hi: number | null;
}

export interface PrefEntry {
  key: string;
  name: string;
  bbox: BBox;
  veg: string;
  vegBytes: number;
  kokuyu: string;
  kokuyuBytes: number;
  built: string;
  legends: Legend[];
}

export interface PrefIndex {
  version: number;
  prefs: PrefEntry[];
}

export interface Memo {
  id: string;
  lat: number;
  lon: number;
  time: string; // ISO 8601
  text: string;
  // Last change (ms since epoch); merges and sync keep the newer copy. Absent = `time`.
  updatedAt?: number;
  // Tombstone: kept (hidden) so a deletion wins over older copies on other devices.
  deleted?: boolean;
}

/** How terrain outside/inside the band is drawn: grey out outside, tint inside, or nothing. */
export type ElevationMode = 'mask' | 'highlight' | 'none';

/** Slope-aspect filter: show only slopes facing the allowed directions (aspect.ts). */
export interface AspectSetting {
  enabled: boolean;
  allowed: boolean[]; // 8 entries: 北, 北東, 東, 南東, 南, 南西, 西, 北西
}

export interface ElevationRange {
  enabled: boolean;
  min: number;
  max: number;
  // Optional so settings saved before terrain shading existed still load (treated as 'mask').
  mode?: ElevationMode;
}

export interface SavedArea {
  id: string;
  bbox: BBox;
  maxZoom: number;
  tiles: number;
  bytes: number;
  savedAt: string;
}
