import type { Map as MlMap } from 'maplibre-gl';
import { DEM_SOURCE } from './basemap';
import {
  elevationBandColor,
  entriesFilter,
  entriesLineColor,
  entriesPattern,
  withOwner,
  type EntryLike,
} from './style';
import type { ElevationRange } from './types';

// Layer names inside the PMTiles, set by pipeline/vegmap/build.py (write_pmtiles layer=...).
const VEG_LAYER = 'veg';
const KOKUYU_LAYER = 'kokuyu';
const VEG_OPACITY = 0.5;
const KOKUYU_COLOR = '#6b3d00';

export const ids = (key: string) => ({
  vegSrc: `veg-${key}`,
  kokSrc: `kok-${key}`,
  vegHit: `veg-hit-${key}`,
  vegFill: `veg-fill-${key}`,
  vegLine: `veg-line-${key}`,
  kokHit: `kok-hit-${key}`,
  kokLine: `kok-line-${key}`,
});

const DEM_SRC = 'gsi-dem';
const ELEV_LAYER = 'elev-band';

/**
 * Vegetation goes under the elevation mask (so the mask can grey it out) and under the base
 * map's labels (so place names stay readable).
 */
function firstSymbolLayer(map: MlMap): string | undefined {
  if (map.getLayer(ELEV_LAYER)) return ELEV_LAYER;
  return map.getStyle().layers.find((l) => l.type === 'symbol')?.id;
}

/** Terrain shading for the elevation band; added once after the base style loads. */
export function addElevationLayer(map: MlMap): void {
  if (map.getLayer(ELEV_LAYER)) return;
  map.addSource(DEM_SRC, DEM_SOURCE);
  map.addLayer(
    { id: ELEV_LAYER, type: 'color-relief', source: DEM_SRC, layout: { visibility: 'none' } },
    map.getStyle().layers.find((l) => l.type === 'symbol')?.id,
  );
}

const ASPECT_SRC = 'gsi-aspect';
const ASPECT_LAYER = 'aspect-mask';
// Below z10 slopes are too small on screen to matter, and computing them would be wasted work.
const ASPECT_MIN_ZOOM = 10;

/** Slope-aspect mask (raster from aspect.ts), drawn just above the elevation mask. */
export function addAspectLayer(map: MlMap, tilesUrl: string): void {
  if (map.getLayer(ASPECT_LAYER)) return;
  map.addSource(ASPECT_SRC, {
    type: 'raster',
    tiles: [tilesUrl],
    tileSize: 256,
    minzoom: ASPECT_MIN_ZOOM,
    maxzoom: DEM_SOURCE.maxzoom,
  });
  map.addLayer(
    { id: ASPECT_LAYER, type: 'raster', source: ASPECT_SRC, layout: { visibility: 'none' } },
    map.getStyle().layers.find((l) => l.type === 'symbol')?.id,
  );
}

/** New options come with a new tile URL, which makes MapLibre re-render the mask tiles. */
export function applyAspect(map: MlMap, tilesUrl: string, enabled: boolean): void {
  const src = map.getSource(ASPECT_SRC) as { setTiles?: (t: string[]) => void } | undefined;
  if (!src || !map.getLayer(ASPECT_LAYER)) return;
  map.setLayoutProperty(ASPECT_LAYER, 'visibility', enabled ? 'visible' : 'none');
  if (enabled) src.setTiles?.([tilesUrl]);
}

export function applyElevationBand(map: MlMap, elev: ElevationRange): void {
  if (!map.getLayer(ELEV_LAYER)) return;
  const color = elevationBandColor(elev);
  map.setLayoutProperty(ELEV_LAYER, 'visibility', color ? 'visible' : 'none');
  if (color) map.setPaintProperty(ELEV_LAYER, 'color-relief-color', color);
}

export function addPrefLayers(map: MlMap, key: string, urls: { veg: string; kokuyu: string }): void {
  const id = ids(key);
  if (map.getSource(id.vegSrc)) return;
  const before = firstSymbolLayer(map);
  map.addSource(id.vegSrc, { type: 'vector', url: urls.veg });
  map.addSource(id.kokSrc, { type: 'vector', url: urls.kokuyu });
  // Invisible fill so a tap anywhere reports the legend, even for unselected vegetation.
  map.addLayer(
    { id: id.vegHit, type: 'fill', source: id.vegSrc, 'source-layer': VEG_LAYER, paint: { 'fill-opacity': 0 } },
    before,
  );
  map.addLayer(
    {
      id: id.vegFill,
      type: 'fill',
      source: id.vegSrc,
      'source-layer': VEG_LAYER,
      paint: { 'fill-opacity': VEG_OPACITY },
      layout: { visibility: 'none' },
    },
    before,
  );
  map.addLayer(
    {
      id: id.vegLine,
      type: 'line',
      source: id.vegSrc,
      'source-layer': VEG_LAYER,
      paint: { 'line-width': ['interpolate', ['linear'], ['zoom'], 10, 0.3, 15, 1.2] },
      layout: { visibility: 'none' },
    },
    before,
  );
  map.addLayer(
    {
      id: id.kokHit,
      type: 'fill',
      source: id.kokSrc,
      'source-layer': KOKUYU_LAYER,
      paint: { 'fill-opacity': 0 },
      layout: { visibility: 'none' },
    },
    before,
  );
  map.addLayer(
    {
      id: id.kokLine,
      type: 'line',
      source: id.kokSrc,
      'source-layer': KOKUYU_LAYER,
      paint: { 'line-color': KOKUYU_COLOR, 'line-width': 1.5, 'line-dasharray': [3, 2] },
      layout: { visibility: 'none' },
    },
    before,
  );
}

export function removePrefLayers(map: MlMap, key: string): void {
  const id = ids(key);
  for (const layer of [id.vegHit, id.vegFill, id.vegLine, id.kokHit, id.kokLine]) {
    if (map.getLayer(layer)) map.removeLayer(layer);
  }
  for (const src of [id.vegSrc, id.kokSrc]) {
    if (map.getSource(src)) map.removeSource(src);
  }
}

export function applyVegStyle(
  map: MlMap,
  key: string,
  entries: EntryLike[],
  elev: ElevationRange,
  attachedKeys: string[],
): void {
  const id = ids(key);
  if (!map.getLayer(id.vegFill)) return;
  const filter = entriesFilter(entries, elev);
  const visibility = filter ? 'visible' : 'none';
  // The tap layer follows the ownership rule too, so a border polygon is reported once.
  map.setFilter(id.vegHit, withOwner(null, key, attachedKeys));
  for (const layer of [id.vegFill, id.vegLine]) {
    map.setLayoutProperty(layer, 'visibility', visibility);
    if (filter) map.setFilter(layer, withOwner(filter, key, attachedKeys));
  }
  if (!filter) return;
  // Solid colour for one matching group, stripes for several (images from patterns.ts).
  map.setPaintProperty(id.vegFill, 'fill-pattern', entriesPattern(entries, elev));
  map.setPaintProperty(id.vegLine, 'line-color', entriesLineColor(entries, elev));
}

export function applyKokuyuVisibility(map: MlMap, key: string, visible: boolean): void {
  const id = ids(key);
  for (const layer of [id.kokHit, id.kokLine]) {
    if (map.getLayer(layer)) map.setLayoutProperty(layer, 'visibility', visible ? 'visible' : 'none');
  }
}

export function hitLayerIds(map: MlMap, keys: string[]): string[] {
  return keys
    .flatMap((k) => [ids(k).vegHit, ids(k).kokHit])
    .filter((l) => map.getLayer(l) && map.getLayoutProperty(l, 'visibility') !== 'none');
}
