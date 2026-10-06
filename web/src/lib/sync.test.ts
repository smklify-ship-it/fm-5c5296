import { describe, expect, it } from 'vitest';
import { toSharedGroups } from './backup';
import { createGroup, deleteGroup, EMPTY_STATE, stampChanged } from './groups';
import { deviceLabel, planGroups, planMemos, toDoc } from './sync';
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

describe('planMemos', () => {
  it('pushes memos the cloud does not have', () => {
    expect(planMemos([memo('a', 1)], []).push.map((m) => m.id)).toEqual(['a']);
  });

  it('pushes a local copy newer than the cloud copy', () => {
    expect(planMemos([memo('a', 5)], [memo('a', 3)]).push).toHaveLength(1);
  });

  it('does not push when the cloud copy is the same or newer', () => {
    expect(planMemos([memo('a', 3)], [memo('a', 5)]).push).toEqual([]);
  });

  it('pushes a local deletion (tombstone) over an older cloud copy', () => {
    expect(planMemos([memo('a', 9, { deleted: true })], [memo('a', 3)]).push[0].deleted).toBe(true);
  });

  it('is already in sync when both sides match', () => {
    expect(planMemos([memo('a', 1)], [memo('a', 1)]).push).toEqual([]);
  });
});

const local = () => stampChanged(EMPTY_STATE, createGroup(EMPTY_STATE, 'マイタケ', [1], 'g1'), 100);

describe('planGroups', () => {
  it('pushes a group the cloud does not have', () => {
    expect(planGroups(local(), [], []).pushGroups.map((g) => g.id)).toEqual(['g1']);
  });

  it('does not push a group already in the cloud with the same stamp', () => {
    expect(planGroups(local(), toSharedGroups(local()), []).pushGroups).toEqual([]);
  });

  it('pushes a local deletion as a tombstone', () => {
    const deleted = deleteGroup(local(), 'g1', 500);
    expect(planGroups(deleted, toSharedGroups(local()), []).pushTombstones).toEqual([{ id: 'g1', updatedAt: 500 }]);
  });

  it('does not push a group the cloud deleted later', () => {
    expect(planGroups(local(), [], [{ id: 'g1', updatedAt: 900 }]).pushGroups).toEqual([]);
  });
});

describe('deviceLabel', () => {
  it('recognises Android', () => {
    expect(deviceLabel('Mozilla/5.0 (Linux; Android 14; Pixel 8) Chrome/130')).toBe('Android');
  });

  it('recognises iPhone', () => {
    expect(deviceLabel('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)')).toBe('iPhone');
  });
});

describe('toDoc', () => {
  it('drops undefined fields (Firestore rejects them)', () => {
    expect(toDoc({ a: 1, b: undefined })).toEqual({ a: 1 });
  });
});
