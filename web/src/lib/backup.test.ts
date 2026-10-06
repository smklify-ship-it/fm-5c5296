import { describe, expect, it } from 'vitest';
import { buildBackup, mergeMemos, mergeSelection, parseBackup, toSharedGroups } from './backup';
import { createGroup, deleteGroup, EMPTY_STATE, stampChanged, updateGroup, type SelectionState } from './groups';
import type { Memo } from './types';

const memo = (id: string, updatedAt: number, extra: Partial<Memo> = {}): Memo => ({
  id,
  lat: 36.5,
  lon: 139,
  time: '2026-10-01T00:00:00.000Z',
  text: id,
  updatedAt,
  ...extra,
});

describe('mergeMemos', () => {
  it('unions memos from both sides', () => {
    expect(mergeMemos([memo('a', 1)], [memo('b', 1)]).map((m) => m.id).sort()).toEqual(['a', 'b']);
  });

  it('keeps the newer copy of the same memo', () => {
    expect(mergeMemos([memo('a', 1, { text: 'old' })], [memo('a', 2, { text: 'new' })])[0].text).toBe('new');
  });

  it('does not let an older copy resurrect a deleted memo', () => {
    expect(mergeMemos([memo('a', 5, { deleted: true })], [memo('a', 3)])[0].deleted).toBe(true);
  });

  it('keeps the local copy on a tie', () => {
    expect(mergeMemos([memo('a', 1, { text: 'mine' })], [memo('a', 1, { text: 'theirs' })])[0].text).toBe('mine');
  });
});

const base = (): SelectionState => stampChanged(EMPTY_STATE, createGroup(EMPTY_STATE, 'マイタケ', [1, 2], 'g1'), 100);

describe('mergeSelection', () => {
  it('adds a group that only exists in the incoming data', () => {
    const incoming = toSharedGroups(base());
    expect(mergeSelection(EMPTY_STATE, incoming, []).groups.map((g) => g.name)).toEqual(['マイタケ']);
  });

  it('replaces members with those of the newer incoming group', () => {
    const newer = toSharedGroups(stampChanged(base(), createGroup(base(), 'x', [], 'tmp'), 0));
    newer[0] = { ...newer[0], members: [1, 3], updatedAt: 200 };
    const merged = mergeSelection(base(), newer, []);
    expect(merged.selected.filter((s) => s.group === 'g1').map((s) => s.code)).toEqual([1, 3]);
  });

  it('keeps the local group when it is newer', () => {
    const older = toSharedGroups(base()).map((g) => ({ ...g, name: '古い', updatedAt: 50 }));
    expect(mergeSelection(base(), older, []).groups[0].name).toBe('マイタケ');
  });

  it('keeps the local hidden flag (display state stays per device)', () => {
    const local = updateGroup(base(), 'g1', { hidden: true });
    const incoming = toSharedGroups(base()).map((g) => ({ ...g, name: '新', updatedAt: 300 }));
    expect(mergeSelection(local, incoming, []).groups[0].hidden).toBe(true);
  });

  it('removes a group deleted later on another device', () => {
    const merged = mergeSelection(base(), [], [{ id: 'g1', updatedAt: 500 }]);
    expect([merged.groups.length, merged.selected.length]).toEqual([0, 0]);
  });

  it('keeps a group changed after it was deleted elsewhere', () => {
    expect(mergeSelection(base(), [], [{ id: 'g1', updatedAt: 50 }]).groups).toHaveLength(1);
  });

  it('does not re-add a group this device deleted', () => {
    const deleted = deleteGroup(base(), 'g1', 400);
    expect(mergeSelection(deleted, toSharedGroups(base()), []).groups).toHaveLength(0);
  });

  it('adds incoming individual selections that are missing', () => {
    expect(mergeSelection(EMPTY_STATE, [], [], [{ code: 9, color: '#e6194b' }]).selected).toEqual([
      { code: 9, color: '#e6194b' },
    ]);
  });
});

describe('stampChanged', () => {
  it('stamps a group whose members changed', () => {
    const before = base();
    const after = createGroup(before, 'y', [], 'g2');
    const withMember = { ...after, selected: [...after.selected, { code: 7, color: '#000', group: 'g1' }] };
    expect(stampChanged(before, withMember, 999).groups.find((g) => g.id === 'g1')?.updatedAt).toBe(999);
  });

  it('does not stamp a display-only change (hidden)', () => {
    const before = base();
    expect(stampChanged(before, updateGroup(before, 'g1', { hidden: true }), 999).groups[0].updatedAt).toBe(100);
  });
});

describe('backup file', () => {
  it('round-trips memos and groups', () => {
    const file = JSON.stringify(buildBackup([memo('a', 1)], base(), {}, new Date(0)));
    const back = parseBackup(file);
    expect([back.memos.length, back.groups[0].members]).toEqual([1, [1, 2]]);
  });

  it('rejects text that is not JSON', () => {
    expect(() => parseBackup('not json')).toThrow('JSONではありません');
  });

  it('rejects a file from another app', () => {
    expect(() => parseBackup('{"app":"other"}')).toThrow('このアプリのバックアップファイルではありません');
  });

  it('rejects a newer format', () => {
    expect(() => parseBackup('{"app":"veg-map","format":99}')).toThrow('新しい版');
  });

  it('skips malformed memos instead of failing the whole import', () => {
    const text = JSON.stringify({ app: 'veg-map', format: 1, memos: [{ id: 'x' }, memo('ok', 1)] });
    expect(parseBackup(text).memos.map((m) => m.id)).toEqual(['ok']);
  });
});
