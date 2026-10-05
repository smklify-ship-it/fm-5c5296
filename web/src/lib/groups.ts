/**
 * Colour groups for selected legends. Pure state transitions (no React, no storage) so the
 * rules are unit tested; App.tsx holds the state and persists it.
 *
 * Rules: a legend is selected at most once, either on its own (own colour) or as a member of
 * exactly one group (painted with the group colour). Hiding a group hides all its members.
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

/** Display options that change what resolveForMap returns. */
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

/** Drop dangling group references (e.g. edited storage) so members never vanish silently. */
export function normalize(state: SelectionState): SelectionState {
  const ids = new Set(state.groups.map((g) => g.id));
  return {
    groups: state.groups,
    selected: state.selected.map((s) => (s.group && !ids.has(s.group) ? { ...s, group: undefined } : s)),
  };
}

/** Put `code` under `target`, adding it if needed. Leaving a group gives it a fresh own colour. */
export function assign(state: SelectionState, code: number, target: Target): SelectionState {
  const group = groupExists(state, target) ? target : undefined;
  const existing = state.selected.find((s) => s.code === code);
  if (!existing) {
    const color = group ? (state.groups.find((g) => g.id === group)?.color ?? freeColor(state)) : freeColor(state);
    return { ...state, selected: [...state.selected, { code, color, group }] };
  }
  if (existing.group === group) return state;
  const color = group || !existing.group ? existing.color : freeColor(state);
  return {
    ...state,
    selected: state.selected.map((s) => (s.code === code ? { ...s, group, color } : s)),
  };
}

/** Checkbox semantics in search results: selected → remove, otherwise add under `target`. */
export function toggle(state: SelectionState, code: number, target: Target): SelectionState {
  return state.selected.some((s) => s.code === code) ? remove(state, code) : assign(state, code, target);
}

/** "Select all results": add missing ones and move already-selected ones under `target`. */
export function assignMany(state: SelectionState, codes: number[], target: Target): SelectionState {
  return codes.reduce((acc, code) => assign(acc, code, target), state);
}

export function remove(state: SelectionState, code: number): SelectionState {
  return { ...state, selected: state.selected.filter((s) => s.code !== code) };
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

/** Deletes the group together with its members (the UI confirms first). */
export function deleteGroup(state: SelectionState, id: string): SelectionState {
  return {
    groups: state.groups.filter((g) => g.id !== id),
    selected: state.selected.filter((s) => s.group !== id),
  };
}

export function setHidden(state: SelectionState, code: number, hidden: boolean): SelectionState {
  return { ...state, selected: state.selected.map((s) => (s.code === code ? { ...s, hidden } : s)) };
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

/**
 * What the map draws: members take their group's colour and band, and are hidden with the
 * group (or when the group is out of season and "今が旬だけ表示" is on).
 */
export function resolveForMap(state: SelectionState, view?: ViewOptions): Selection[] {
  const byId = new Map(state.groups.map((g) => [g.id, g]));
  return state.selected.map((s) => {
    const g = s.group ? byId.get(s.group) : undefined;
    return {
      code: s.code,
      color: g?.color ?? s.color,
      hidden: Boolean(s.hidden || (g && groupOff(g, view))),
      band: g?.elev,
    };
  });
}

/** Normalise a user-entered band: both ends required, swapped if reversed, 0–4000 m. */
export function makeBand(min: number | null, max: number | null): [number, number] | undefined {
  if (min === null || max === null || !Number.isFinite(min) || !Number.isFinite(max)) return undefined;
  const clamp = (v: number) => Math.min(4000, Math.max(0, Math.round(v)));
  const [a, b] = [clamp(min), clamp(max)];
  return a <= b ? [a, b] : [b, a];
}

/** Groups (visible, in season) whose legends include `code` and whose band overlaps the polygon. */
export function groupsMatching(
  state: SelectionState,
  code: number,
  lo: number | null,
  hi: number | null,
  view?: ViewOptions,
): Group[] {
  const member = state.selected.find((s) => s.code === code && s.group && !s.hidden);
  if (!member) return [];
  return state.groups.filter((g) => {
    if (g.id !== member.group || groupOff(g, view)) return false;
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
