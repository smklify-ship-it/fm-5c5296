import type { BBox } from './types';

// Web Mercator cannot represent the poles; clamp like every slippy-map implementation.
const MAX_LAT = 85.05112878;

export function lonLatToTile(lon: number, lat: number, z: number): [number, number] {
  const clamped = Math.max(-MAX_LAT, Math.min(MAX_LAT, lat));
  const n = 2 ** z;
  const rad = (clamped * Math.PI) / 180;
  const x = ((lon + 180) / 360) * n;
  const y = ((1 - Math.log(Math.tan(rad) + 1 / Math.cos(rad)) / Math.PI) / 2) * n;
  return [Math.min(n - 1, Math.floor(x)), Math.min(n - 1, Math.floor(y))];
}

export type TileId = [z: number, x: number, y: number];

export function tilesInBbox(bbox: BBox, zmin: number, zmax: number): TileId[] {
  const [west, south, east, north] = bbox;
  if (west > east || south > north) {
    throw new Error(`invalid bbox (west,south,east,north): ${bbox.join(',')}`);
  }
  const tiles: TileId[] = [];
  for (let z = zmin; z <= zmax; z++) {
    const [x0, y0] = lonLatToTile(west, north, z);
    const [x1, y1] = lonLatToTile(east, south, z);
    for (let x = x0; x <= x1; x++) {
      for (let y = y0; y <= y1; y++) tiles.push([z, x, y]);
    }
  }
  return tiles;
}

export function countTilesInBbox(bbox: BBox, zmin: number, zmax: number): number {
  const [west, south, east, north] = bbox;
  let total = 0;
  for (let z = zmin; z <= zmax; z++) {
    const [x0, y0] = lonLatToTile(west, north, z);
    const [x1, y1] = lonLatToTile(east, south, z);
    total += (x1 - x0 + 1) * (y1 - y0 + 1);
  }
  return total;
}

export function tileKey(z: number, x: number, y: number): string {
  return `${z}/${x}/${y}`;
}
