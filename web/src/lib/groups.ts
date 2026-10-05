/**
 * Colour groups for selected legends. Pure state transitions (no React, no storage) so the
 * rules are unit tested; App.tsx holds the state and persists it.
 *
 * Rules: a legend is selected at most once, either on its own (own colour) or as a member of
 * exactly one group (painted with the group colour). Hiding a group hides all its members.
 */
import { nextFreeColor, type Selection } from './style';

export interface Group {
  id: string;
  name: string;
  color: string;
  hidden?: boolean;
  collapsed?: boolean;
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
  patch: Partial<Pick<Group, 'color' | 'hidden' | 'collapsed'>>,
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

/** What the map draws: members take their group's colour and are hidden with the group. */
export function resolveForMap(state: SelectionState): Selection[] {
  const byId = new Map(state.groups.map((g) => [g.id, g]));
  return state.selected.map((s) => {
    const g = s.group ? byId.get(s.group) : undefined;
    return {
      code: s.code,
      color: g?.color ?? s.color,
      hidden: Boolean(s.hidden || g?.hidden),
    };
  });
}

export function membersOf(state: SelectionState, id: string): Selection[] {
  return state.selected.filter((s) => s.group === id);
}

export function individuals(state: SelectionState): Selection[] {
  return state.selected.filter((s) => !s.group);
}
