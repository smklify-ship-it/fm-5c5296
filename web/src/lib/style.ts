import type { ExpressionSpecification, FilterSpecification } from 'maplibre-gl';
import type { ElevationRange } from './types';

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
}

export function visibleSelections(selected: Selection[]): Selection[] {
  return selected.filter((s) => !s.hidden);
}

export function nextColor(selected: Selection[]): string {
  const used = new Set(selected.map((s) => s.color));
  const free = PALETTE.find((c) => !used.has(c));
  return free ?? colorFor(selected.length);
}

/** Filter for the coloured vegetation layer; null means "nothing to show → hide layer". */
export function vegFilter(selected: Selection[], elev: ElevationRange): FilterSpecification | null {
  const shown = visibleSelections(selected);
  if (shown.length === 0) return null;
  const codes = shown.map((s) => s.code);
  const inSelection: ExpressionSpecification = ['in', ['get', 'c'], ['literal', codes]];
  if (!elev.enabled) return inSelection;
  // Overlap test [lo, hi] ∩ [min, max] ≠ ∅. Polygons without DEM data (null) stay visible
  // rather than silently disappearing.
  return [
    'all',
    inSelection,
    ['>=', ['coalesce', ['get', 'hi'], elev.max], elev.min],
    ['<=', ['coalesce', ['get', 'lo'], elev.min], elev.max],
  ];
}

export function vegColor(selected: Selection[]): ExpressionSpecification | string {
  if (selected.length === 0) return UNSELECTED_COLOR;
  const pairs = selected.flatMap((s) => [s.code, s.color]);
  // The spec type models `match` as a fixed-arity tuple and cannot express a spread of
  // label/value pairs, so the (valid) runtime expression is cast through unknown.
  return ['match', ['get', 'c'], ...pairs, UNSELECTED_COLOR] as unknown as ExpressionSpecification;
}
