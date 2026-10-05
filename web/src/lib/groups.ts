/**
 * Colour groups for selected legends. Pure state transitions (no React, no storage) so the
 * rules are unit tested; App.tsx holds the state and persists it.
 *
 * Rules: one entry per (legend, group). A legend may be selected once on its own (own colour)
 * and, independently, in any number of groups (painted with each group's colour; polygons that
 * match several entries are drawn striped). Hiding a group hides all its members.
 * A group may carry mushroom conditions: its own elevation band and fruiting months.
 */
import { nextFreeColor, type Selection } from './style';

export interface Group {
  id: string;
  name: string;
  color: string;
  hidden?: boolean;
  collapsed?: boolean;
  // Own elevation band [min, max] m; overrides the global elevation filter for its members.
  elev?: [number, number];
  // Fruiting months 1–12, used by "今が旬だけ表示".
  months?: number[];
}

/** Display options that change what drawEntries returns. */
export interface ViewOptions {
  seasonOnly: boolean;
  month: number; // 1–12, the current month
}

export interface SelectionState {
  selected: Selection[];
  groups: Group[];
}

/** null = add as an individual selection; otherwise a group id. */
export type Target = string | null;

export const EMPTY_STATE: SelectionState = { selected: [], groups: [] };
const DEFAULT_GROUP_NAME = '新しいグループ';

/** Colours currently on the map: every group plus every individual selection. */
export function usedColors(state: SelectionState): string[] {
  return [
    ...state.groups.map((g) => g.color),
    ...state.selected.filter((s) => !s.group).map((s) => s.color),
  ];
}

function freeColor(state: SelectionState): string {
  return nextFreeColor(usedColors(state));
}

function groupExists(state: SelectionState, target: Target): target is string {
  return target !== null && state.groups.some((g) => g.id === target);
}

function sameEntry(s: Selection, code: number, group: string | undefined): boolean {
  return s.code === code && (s.group ?? undefined) === group;
}

/**
 * Keep stored state consistent: entries of a deleted group become individual selections, and
 * duplicate (legend, group) entries (e.g. hand-edited storage) collapse to one.
 */
export function normalize(state: SelectionState): SelectionState {
  const ids = new Set(state.groups.map((g) => g.id));
  const seen = new Set<string>();
  const selected: Selection[] = [];
  for (const s of state.selected) {
    const fixed = s.group && !ids.has(s.group) ? { ...s, group: undefined } : s;
    const key = `${fixed.code}|${fixed.group ?? ''}`;
    if (seen.has(key)) continue;
    seen.add(key);
    selected.push(fixed);
  }
  return { groups: state.groups, selected };
}

export function hasEntry(state: SelectionState, code: number, target: Target): boolean {
  const group = groupExists(state, target) ? target : undefined;
  return state.selected.some((s) => sameEntry(s, code, group));
}

/** Add `code` to `target` (a group, or individual when null). Other entries are untouched. */
export function assign(state: SelectionState, code: number, target: Target): SelectionState {
  const group = groupExists(state, target) ? target : undefined;
  if (state.selected.some((s) => sameEntry(s, code, group))) return state;
  const color = group
    ? (state.groups.find((g) => g.id === group)?.color ?? freeColor(state))
    : freeColor(state);
  return { ...state, selected: [...state.selected, { code, color, group }] };
}

/** Checkbox semantics in search results: in `target` → remove from it, otherwise add to it. */
export function toggle(state: SelectionState, code: number, target: Target): SelectionState {
  const group = groupExists(state, target) ? target : undefined;
  return hasEntry(state, code, target) ? remove(state, code, group) : assign(state, code, target);
}

/** "Add all results": add every legend to `target` (already-present ones are kept as is). */
export function assignMany(state: SelectionState, codes: number[], target: Target): SelectionState {
  return codes.reduce((acc, code) => assign(acc, code, target), state);
}

/** Remove one entry: `group` undefined = the individual selection of `code`. */
export function remove(state: SelectionState, code: number, group?: string): SelectionState {
  return { ...state, selected: state.selected.filter((s) => !sameEntry(s, code, group)) };
}

export function createGroup(
  state: SelectionState,
  name: string,
  codes: number[],
  id: string,
): SelectionState {
  const group: Group = { id, name: name.trim() || DEFAULT_GROUP_NAME, color: freeColor(state) };
  const withGroup = { ...state, groups: [...state.groups, group] };
  return assignMany(withGroup, codes, id);
}

export function renameGroup(state: SelectionState, id: string, name: string): SelectionState {
  const trimmed = name.trim();
  if (!trimmed) return state; // an empty name is almost always an accidental clear
  return { ...state, groups: state.groups.map((g) => (g.id === id ? { ...g, name: trimmed } : g)) };
}

export function updateGroup(
  state: SelectionState,
  id: string,
  patch: Partial<Pick<Group, 'color' | 'hidden' | 'collapsed' | 'elev' | 'months'>>,
): SelectionState {
  return { ...state, groups: state.groups.map((g) => (g.id === id ? { ...g, ...patch } : g)) };
}

/** Deletes the group together with its member entries (the UI confirms first). */
export function deleteGroup(state: SelectionState, id: string): SelectionState {
  return {
    groups: state.groups.filter((g) => g.id !== id),
    selected: state.selected.filter((s) => s.group !== id),
  };
}

export function setHidden(
  state: SelectionState,
  code: number,
  group: string | undefined,
  hidden: boolean,
): SelectionState {
  return {
    ...state,
    selected: state.selected.map((s) => (sameEntry(s, code, group) ? { ...s, hidden } : s)),
  };
}

/** Show/hide everything, groups included, so "すべて表示" really shows everything. */
export function setAllHidden(state: SelectionState, hidden: boolean): SelectionState {
  return {
    groups: state.groups.map((g) => ({ ...g, hidden })),
    selected: state.selected.map((s) => ({ ...s, hidden })),
  };
}

/** A group without months is "always in season" (the season toggle only hides known misses). */
export function inSeason(group: Group, month: number): boolean {
  return !group.months || group.months.length === 0 || group.months.includes(month);
}

/** Group hidden by its own checkbox, or by the season toggle. */
export function groupOff(group: Group, view?: ViewOptions): boolean {
  return Boolean(group.hidden || (view?.seasonOnly && !inSeason(group, view.month)));
}

/** One colour layer on the map: a visible group, or one individual legend. */
export interface DrawEntry {
  key: string; // stable id: the group id, or "i<code>" for an individual legend
  color: string;
  codes: number[];
  band?: [number, number]; // own band; undefined = the global elevation filter
}

/**
 * What the map draws, in list order (groups first). Hidden members, hidden groups, empty
 * groups and out-of-season groups (when "今が旬だけ表示" is on) are left out.
 */
export function drawEntries(state: SelectionState, view?: ViewOptions): DrawEntry[] {
  const entries: DrawEntry[] = [];
  for (const g of state.groups) {
    if (groupOff(g, view)) continue;
    const codes = state.selected.filter((s) => s.group === g.id && !s.hidden).map((s) => s.code);
    if (codes.length > 0) entries.push({ key: g.id, color: g.color, codes, band: g.elev });
  }
  for (const s of state.selected) {
    if (!s.group && !s.hidden) entries.push({ key: `i${s.code}`, color: s.color, codes: [s.code] });
  }
  return entries;
}

/** Legends drawn by two or more entries (striped where their conditions overlap). */
export function sharedCodes(entries: DrawEntry[]): Set<number> {
  const count = new Map<number, number>();
  for (const e of entries) for (const c of e.codes) count.set(c, (count.get(c) ?? 0) + 1);
  return new Set([...count].filter(([, n]) => n > 1).map(([c]) => c));
}

/** Normalise a user-entered band: both ends required, swapped if reversed, 0–4000 m. */
export function makeBand(min: number | null, max: number | null): [number, number] | undefined {
  if (min === null || max === null || !Number.isFinite(min) || !Number.isFinite(max)) return undefined;
  const clamp = (v: number) => Math.min(4000, Math.max(0, Math.round(v)));
  const [a, b] = [clamp(min), clamp(max)];
  return a <= b ? [a, b] : [b, a];
}

/** Groups (visible, in season) containing `code` whose band overlaps the polygon's range. */
export function groupsMatching(
  state: SelectionState,
  code: number,
  lo: number | null,
  hi: number | null,
  view?: ViewOptions,
): Group[] {
  const memberOf = new Set(
    state.selected.filter((s) => s.code === code && s.group && !s.hidden).map((s) => s.group),
  );
  return state.groups.filter((g) => {
    if (!memberOf.has(g.id) || groupOff(g, view)) return false;
    if (!g.elev || lo === null || hi === null) return true;
    return hi >= g.elev[0] && lo <= g.elev[1];
  });
}

/** Short text such as "800–1600m・9,10月" for headers and the map legend. */
export function conditionText(group: Group): string {
  const parts: string[] = [];
  if (group.elev) parts.push(`${group.elev[0]}–${group.elev[1]}m`);
  if (group.months && group.months.length > 0) {
    parts.push(`${[...group.months].sort((a, b) => a - b).join(',')}月`);
  }
  return parts.join('・');
}

export function membersOf(state: SelectionState, id: string): Selection[] {
  return state.selected.filter((s) => s.group === id);
}

export function individuals(state: SelectionState): Selection[] {
  return state.selected.filter((s) => !s.group);
}

/** Names of the groups a legend belongs to (for search results). */
export function groupNamesOf(state: SelectionState, code: number): string[] {
  const ids = new Set(state.selected.filter((s) => s.code === code && s.group).map((s) => s.group));
  return state.groups.filter((g) => ids.has(g.id)).map((g) => g.name);
}

/** Colour shown for an entry in lists: the group's colour for members, else its own. */
export function entryColor(state: SelectionState, s: Selection): string {
  return (s.group && state.groups.find((g) => g.id === s.group)?.color) || s.color;
}
