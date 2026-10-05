import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { dbAll, dbClear, dbDelete, dbGet, dbHasKey, dbKeys, dbPut, dbPutMany, resetDbForTests, STORES } from './db';

beforeEach(async () => {
  resetDbForTests();
  await dbClear(STORES.tiles);
  await dbClear(STORES.memos);
});

describe('db', () => {
  it('stores and reads back a value', async () => {
    await dbPut(STORES.memos, 'm1', { text: 'x' });
    expect(await dbGet(STORES.memos, 'm1')).toEqual({ text: 'x' });
  });

  it('putMany writes every entry', async () => {
    await dbPutMany(STORES.tiles, [
      ['1/0/0', new ArrayBuffer(1)],
      ['1/0/1', new ArrayBuffer(2)],
    ]);
    expect(await dbAll(STORES.tiles)).toHaveLength(2);
  });

  it('hasKey is false after delete', async () => {
    await dbPut(STORES.tiles, '2/1/1', new ArrayBuffer(1));
    await dbDelete(STORES.tiles, '2/1/1');
    expect(await dbHasKey(STORES.tiles, '2/1/1')).toBe(false);
  });

  it('missing key reads as undefined', async () => {
    expect(await dbGet(STORES.memos, 'nope')).toBeUndefined();
  });

  it('lists stored keys', async () => {
    await dbPut(STORES.memos, 'a', 1);
    await dbPut(STORES.memos, 'b', 2);
    expect((await dbKeys(STORES.memos)).sort()).toEqual(['a', 'b']);
  });
});
