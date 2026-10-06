/**
 * Backup file (export/import) and the merge rules shared with sync.
 *
 * Merge rule everywhere: per item id, the copy with the newer `updatedAt` wins; deletions are
 * tombstones with their own time, so an old copy on another device cannot resurrect them.
 * Per-device display state (group hidden/collapsed, individual selections' visibility) is not
 * overwritten by a merge.
 */
import {
  memberCodes,
  type Group,
  type GroupTombstone,
  type SelectionState,
} from './groups';
import { nextFreeColor, type Selection } from './style';
import type { ElevationRange, Memo } from './types';

export const BACKUP_APP = 'veg-map';
export const BACKUP_FORMAT = 1;

/** A group as shared between devices: content only, members as legend codes. */
export interface SharedGroup {
  id: string;
  name: string;
  color: string;
  elev?: [number, number];
  months?: number[];
  updatedAt?: number;
  members: number[];
}

export interface BackupSettings {
  elev?: ElevationRange;
  kokuyu?: boolean;
  seasonOnly?: boolean;
}

/** Which parts a backup file holds / an import applies. Groups include individual selections. */
export interface BackupParts {
  memos: boolean;
  groups: boolean;
}

export const ALL_PARTS: BackupParts = { memos: true, groups: true };

export interface Backup {
  app: typeof BACKUP_APP;
  format: number;
  exportedAt: string;
  contents: BackupParts;
  memos: Memo[];
  groups: SharedGroup[];
  tombstones: GroupTombstone[];
  individuals: { code: number; color: string }[];
  settings: BackupSettings;
}

export function memoStamp(m: Memo): number {
  return m.updatedAt ?? (Date.parse(m.time) || 0);
}

export function toSharedGroups(state: SelectionState): SharedGroup[] {
  return state.groups.map((g) => ({
    id: g.id,
    name: g.name,
    color: g.color,
    elev: g.elev,
    months: g.months,
    updatedAt: g.updatedAt,
    members: memberCodes(state, g.id),
  }));
}

export function buildBackup(
  memos: Memo[],
  state: SelectionState,
  settings: BackupSettings,
  now: Date,
  parts: BackupParts = ALL_PARTS,
): Backup {
  return {
    app: BACKUP_APP,
    format: BACKUP_FORMAT,
    exportedAt: now.toISOString(),
    contents: parts,
    memos: parts.memos ? memos : [],
    groups: parts.groups ? toSharedGroups(state) : [],
    tombstones: parts.groups ? (state.tombstones ?? []) : [],
    individuals: parts.groups
      ? state.selected.filter((s) => !s.group).map((s) => ({ code: s.code, color: s.color }))
      : [],
    settings,
  };
}

/** e.g. "veg-map-backup-メモ-2026-10-06.json"; no part label when both are included. */
export function backupFileName(parts: BackupParts, now: Date): string {
  const label = parts.memos && parts.groups ? '' : parts.memos ? '-メモ' : '-グループ';
  return `veg-map-backup${label}-${now.toISOString().slice(0, 10)}.json`;
}

const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

/** Validate an imported file; throws a Japanese message the UI can show as is. */
export function parseBackup(text: string): Backup {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new Error('バックアップファイルとして読めません（JSONではありません）');
  }
  const b = raw as Partial<Backup>;
  if (!b || b.app !== BACKUP_APP) throw new Error('このアプリのバックアップファイルではありません');
  if (!isNum(b.format) || b.format > BACKUP_FORMAT) {
    throw new Error('新しい版のアプリで作られたバックアップです。アプリを更新してください');
  }
  const memos = Array.isArray(b.memos)
    ? b.memos.filter((m) => m && typeof m.id === 'string' && isNum(m.lat) && isNum(m.lon))
    : [];
  const groups = Array.isArray(b.groups)
    ? b.groups.filter((g) => g && typeof g.id === 'string' && Array.isArray(g.members))
    : [];
  // Files written before part selection existed always held everything.
  const contents: BackupParts = {
    memos: b.contents?.memos ?? true,
    groups: b.contents?.groups ?? true,
  };
  return {
    app: BACKUP_APP,
    format: b.format,
    exportedAt: String(b.exportedAt ?? ''),
    contents,
    memos,
    groups,
    tombstones: Array.isArray(b.tombstones) ? b.tombstones.filter((t) => t && typeof t.id === 'string') : [],
    individuals: Array.isArray(b.individuals) ? b.individuals.filter((i) => i && isNum(i.code)) : [],
    settings: b.settings ?? {},
  };
}

/** Union of two memo lists; per id the newer copy (tombstones included) wins, ties keep local. */
export function mergeMemos(local: Memo[], incoming: Memo[]): Memo[] {
  const byId = new Map(local.map((m) => [m.id, m]));
  for (const m of incoming) {
    const mine = byId.get(m.id);
    if (!mine || memoStamp(m) > memoStamp(mine)) byId.set(m.id, m);
  }
  return [...byId.values()];
}

function mergeTombstones(a: GroupTombstone[], b: GroupTombstone[]): GroupTombstone[] {
  const byId = new Map<string, GroupTombstone>();
  for (const t of [...a, ...b]) {
    const seen = byId.get(t.id);
    if (!seen || t.updatedAt > seen.updatedAt) byId.set(t.id, t);
  }
  return [...byId.values()];
}

/**
 * Merge shared groups (and individual selections) into local state. A group present on both
 * sides keeps the newer content; its members are replaced by the winner's, keeping local
 * per-member visibility. A tombstone newer than a group removes it.
 */
export function mergeSelection(
  local: SelectionState,
  incomingGroups: SharedGroup[],
  incomingTombstones: GroupTombstone[],
  incomingIndividuals: { code: number; color: string }[] = [],
): SelectionState {
  const tombstones = mergeTombstones(local.tombstones ?? [], incomingTombstones);
  const deadAt = new Map(tombstones.map((t) => [t.id, t.updatedAt]));
  let groups: Group[] = [...local.groups];
  let selected: Selection[] = [...local.selected];

  for (const inc of incomingGroups) {
    const mine = groups.find((g) => g.id === inc.id);
    if (mine && (mine.updatedAt ?? 0) >= (inc.updatedAt ?? 0)) continue;
    const kept: Group = {
      id: inc.id,
      name: inc.name,
      color: inc.color,
      elev: inc.elev,
      months: inc.months,
      updatedAt: inc.updatedAt,
      hidden: mine?.hidden,
      collapsed: mine?.collapsed,
    };
    groups = mine ? groups.map((g) => (g.id === inc.id ? kept : g)) : [...groups, kept];
    const hiddenBefore = new Set(selected.filter((s) => s.group === inc.id && s.hidden).map((s) => s.code));
    selected = [
      ...selected.filter((s) => s.group !== inc.id),
      ...inc.members.map((code) => ({ code, color: inc.color, group: inc.id, hidden: hiddenBefore.has(code) || undefined })),
    ];
  }

  // Deletions newer than the surviving copy win.
  const removed = new Set(groups.filter((g) => (deadAt.get(g.id) ?? -1) > (g.updatedAt ?? 0)).map((g) => g.id));
  groups = groups.filter((g) => !removed.has(g.id));
  selected = selected.filter((s) => !s.group || !removed.has(s.group));

  for (const ind of incomingIndividuals) {
    if (selected.some((s) => s.code === ind.code && !s.group)) continue;
    const used = [...groups.map((g) => g.color), ...selected.filter((s) => !s.group).map((s) => s.color)];
    const color = used.includes(ind.color) ? nextFreeColor(used) : ind.color;
    selected.push({ code: ind.code, color });
  }
  return { groups, selected, tombstones };
}
