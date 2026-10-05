import type { ExpressionSpecification, FilterSpecification } from 'maplibre-gl';
import type { ElevationMode, ElevationRange } from './types';

// Colour-blind-friendly first, then high-contrast extras; all readable over the GSI base map.
export const PALETTE = [
  '#e6194b',
  '#3cb44b',
  '#4363d8',
  '#f58231',
  '#911eb4',
  '#42d4f4',
  '#f032e6',
  '#9a6324',
  '#469990',
  '#800000',
  '#808000',
  '#000075',
] as const;

export const UNSELECTED_COLOR = '#888888';

/** Colours stay stable per selection order, so adding a legend never recolours the others. */
export function colorFor(index: number): string {
  return PALETTE[index % PALETTE.length];
}

export interface Selection {
  code: number;
  color: string;
  // Optional so selections saved before the show/hide toggle existed load as visible.
  hidden?: boolean;
  // Group id (see groups.ts). Members are painted with the group's colour instead of `color`.
  group?: string;
  // Own elevation band [min, max] m (set by resolveForMap from the group). Overrides the
  // global elevation filter for this legend.
  band?: [number, number];
}

export function visibleSelections(selected: Selection[]): Selection[] {
  return selected.filter((s) => !s.hidden);
}

export function nextColor(selected: Selection[]): string {
  return nextFreeColor(selected.map((s) => s.color));
}

/** First palette colour not in `used`; cycles the palette once every colour is taken. */
export function nextFreeColor(used: string[]): string {
  const taken = new Set(used.map((c) => c.toLowerCase()));
  const free = PALETTE.find((c) => !taken.has(c));
  return free ?? colorFor(used.length);
}

/** Polygon overlap test [lo, hi] ∩ [min, max] ≠ ∅. Polygons without DEM data (null) stay
 *  visible rather than silently disappearing. */
function bandOverlap(min: number, max: number): ExpressionSpecification[] {
  return [
    ['>=', ['coalesce', ['get', 'hi'], max], min],
    ['<=', ['coalesce', ['get', 'lo'], min], max],
  ];
}

/**
 * Filter for the coloured vegetation layer; null means "nothing to show → hide layer".
 * Legends with their own band (mushroom groups) use it; the others use the global band when
 * the elevation filter is on. Legends sharing a band share one clause to keep the filter small.
 */
export function vegFilter(selected: Selection[], elev: ElevationRange): FilterSpecification | null {
  const shown = visibleSelections(selected);
  if (shown.length === 0) return null;
  const byBand = new Map<string, { band: [number, number] | null; codes: number[] }>();
  for (const s of shown) {
    const band = s.band ?? (elev.enabled ? ([elev.min, elev.max] as [number, number]) : null);
    const key = band ? band.join('-') : 'none';
    const entry = byBand.get(key) ?? { band, codes: [] };
    entry.codes.push(s.code);
    byBand.set(key, entry);
  }
  const clauses: ExpressionSpecification[] = [...byBand.values()].map(({ band, codes }) => {
    const inCodes: ExpressionSpecification = ['in', ['get', 'c'], ['literal', codes]];
    return band ? ['all', inCodes, ...bandOverlap(band[0], band[1])] : inCodes;
  });
  return clauses.length === 1 ? clauses[0] : ['any', ...clauses];
}

export function vegColor(selected: Selection[]): ExpressionSpecification | string {
  if (selected.length === 0) return UNSELECTED_COLOR;
  const pairs = selected.flatMap((s) => [s.code, s.color]);
  // The spec type models `match` as a fixed-arity tuple and cannot express a spread of
  // label/value pairs, so the (valid) runtime expression is cast through unknown.
  return ['match', ['get', 'c'], ...pairs, UNSELECTED_COLOR] as unknown as ExpressionSpecification;
}

// Terrain shading for the elevation band (MapLibre `color-relief` over GSI elevation tiles).
export const ELEV_MASK_COLOR = 'rgba(40, 40, 40, 0.55)';
export const ELEV_HIGHLIGHT_COLOR = 'rgba(255, 190, 0, 0.35)';
const TRANSPARENT = 'rgba(0, 0, 0, 0)';
// color-relief interpolates between stops; a 1 m ramp makes the band edge effectively hard
// (DEM pixels are ~15 m apart, so nothing visible falls inside the ramp).
const EDGE_M = 1;

export function effectiveMode(elev: ElevationRange): ElevationMode {
  return elev.enabled ? (elev.mode ?? 'mask') : 'none';
}

/** Colour ramp over ["elevation"]; null means "no terrain shading" (layer hidden). */
export function elevationBandColor(elev: ElevationRange): ExpressionSpecification | null {
  const mode = effectiveMode(elev);
  if (mode === 'none') return null;
  const inside = mode === 'mask' ? TRANSPARENT : ELEV_HIGHLIGHT_COLOR;
  const outside = mode === 'mask' ? ELEV_MASK_COLOR : TRANSPARENT;
  const min = elev.min;
  // Stops must strictly increase even when the band is a single value.
  const max = Math.max(elev.max, min + EDGE_M);
  return [
    'interpolate',
    ['linear'],
    ['elevation'],
    min - EDGE_M,
    outside,
    min,
    inside,
    max,
    inside,
    max + EDGE_M,
    outside,
  ];
}
