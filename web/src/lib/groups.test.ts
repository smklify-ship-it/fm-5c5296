import { describe, expect, it } from 'vitest';
import {
  assign,
  assignMany,
  conditionText,
  createGroup,
  deleteGroup,
  EMPTY_STATE,
  groupsMatching,
  inSeason,
  makeBand,
  normalize,
  renameGroup,
  resolveForMap,
  setAllHidden,
  setHidden,
  toggle,
  updateGroup,
  usedColors,
  type SelectionState,
} from './groups';
import { PALETTE } from './style';

const withGroup = (): SelectionState => createGroup(EMPTY_STATE, 'ミズナラ林', [1, 2], 'g1');

describe('createGroup', () => {
  it('puts the given legends into the new group', () => {
    expect(withGroup().selected.map((s) => [s.code, s.group])).toEqual([
      [1, 'g1'],
      [2, 'g1'],
    ]);
  });

  it('uses the given name', () => {
    expect(withGroup().groups[0].name).toBe('ミズナラ林');
  });

  it('falls back to a default name when the name is blank', () => {
    expect(createGroup(EMPTY_STATE, '  ', [], 'g').groups[0].name).toBe('新しいグループ');
  });

  it('picks a colour not used by existing individual selections', () => {
    const s = assign(EMPTY_STATE, 9, null); // takes PALETTE[0]
    expect(createGroup(s, 'x', [], 'g').groups[0].color).toBe(PALETTE[1]);
  });

  it('moves an already-selected individual legend into the group', () => {
    const s = createGroup(assign(EMPTY_STATE, 1, null), 'x', [1], 'g');
    expect(s.selected).toHaveLength(1);
  });
});

describe('resolveForMap', () => {
  it('paints members with the group colour', () => {
    const s = updateGroup(withGroup(), 'g1', { color: '#123456' });
    expect(resolveForMap(s).map((x) => x.color)).toEqual(['#123456', '#123456']);
  });

  it('hides every member when the group is hidden', () => {
    const s = updateGroup(withGroup(), 'g1', { hidden: true });
    expect(resolveForMap(s).every((x) => x.hidden)).toBe(true);
  });

  it('keeps a hidden member hidden while its group is visible', () => {
    const s = setHidden(withGroup(), 2, true);
    expect(resolveForMap(s).map((x) => x.hidden)).toEqual([false, true]);
  });

  it('keeps the own colour of individual selections', () => {
    const s = assign(withGroup(), 5, null);
    const own = s.selected.find((x) => x.code === 5)?.color;
    expect(resolveForMap(s).find((x) => x.code === 5)?.color).toBe(own);
  });
});

describe('assign / toggle', () => {
  it('adds a new legend directly into a group', () => {
    expect(assign(withGroup(), 3, 'g1').selected.find((s) => s.code === 3)?.group).toBe('g1');
  });

  it('moving a member out of its group gives it a colour unused on the map', () => {
    const s = assign(withGroup(), 1, null);
    const color = s.selected.find((x) => x.code === 1)?.color;
    expect(usedColors(s).filter((c) => c === color)).toHaveLength(1);
  });

  it('treats an unknown group id as individual', () => {
    expect(assign(EMPTY_STATE, 1, 'nope').selected[0].group).toBeUndefined();
  });

  it('toggle removes an already-selected legend', () => {
    expect(toggle(withGroup(), 1, null).selected.map((s) => s.code)).toEqual([2]);
  });

  it('assignMany never selects a legend twice', () => {
    expect(assignMany(withGroup(), [1, 2, 3], null).selected).toHaveLength(3);
  });
});

describe('renameGroup', () => {
  it('renames the group', () => {
    expect(renameGroup(withGroup(), 'g1', '  マイタケ  ').groups[0].name).toBe('マイタケ');
  });

  it('ignores an empty name', () => {
    expect(renameGroup(withGroup(), 'g1', '').groups[0].name).toBe('ミズナラ林');
  });
});

describe('deleteGroup', () => {
  it('removes the group and its members but keeps individuals', () => {
    const s = deleteGroup(assign(withGroup(), 7, null), 'g1');
    expect([s.groups.length, s.selected.map((x) => x.code)]).toEqual([0, [7]]);
  });
});

describe('setAllHidden', () => {
  it('also shows hidden groups again', () => {
    const s = setAllHidden(updateGroup(withGroup(), 'g1', { hidden: true }), false);
    expect(resolveForMap(s).every((x) => !x.hidden)).toBe(true);
  });
});

describe('normalize', () => {
  it('turns members of a missing group into individuals', () => {
    const s = normalize({ groups: [], selected: [{ code: 1, color: '#000', group: 'gone' }] });
    expect(s.selected[0].group).toBeUndefined();
  });
});

describe('mushroom conditions', () => {
  const autumn = (): SelectionState =>
    updateGroup(withGroup(), 'g1', { elev: [800, 1600], months: [9, 10] });

  it('gives members the group band', () => {
    expect(resolveForMap(autumn()).map((s) => s.band)).toEqual([
      [800, 1600],
      [800, 1600],
    ]);
  });

  it('hides an out-of-season group when "今が旬だけ" is on', () => {
    const s = resolveForMap(autumn(), { seasonOnly: true, month: 6 });
    expect(s.every((x) => x.hidden)).toBe(true);
  });

  it('keeps an in-season group visible when "今が旬だけ" is on', () => {
    const s = resolveForMap(autumn(), { seasonOnly: true, month: 10 });
    expect(s.every((x) => !x.hidden)).toBe(true);
  });

  it('ignores the season when the toggle is off', () => {
    const s = resolveForMap(autumn(), { seasonOnly: false, month: 6 });
    expect(s.every((x) => !x.hidden)).toBe(true);
  });

  it('treats a group without months as always in season', () => {
    expect(inSeason({ id: 'x', name: 'x', color: '#000' }, 3)).toBe(true);
  });

  it('formats the condition summary', () => {
    expect(conditionText(autumn().groups[0])).toBe('800–1600m・9,10月');
  });
});

describe('makeBand', () => {
  it('swaps a reversed band', () => {
    expect(makeBand(1600, 800)).toEqual([800, 1600]);
  });

  it('is undefined when an end is missing', () => {
    expect(makeBand(800, null)).toBeUndefined();
  });

  it('clamps to 0–4000 m', () => {
    expect(makeBand(-50, 9000)).toEqual([0, 4000]);
  });
});

describe('groupsMatching', () => {
  const s = (): SelectionState => updateGroup(withGroup(), 'g1', { elev: [800, 1600] });

  it('finds the group when the polygon overlaps its band', () => {
    expect(groupsMatching(s(), 1, 1500, 1900).map((g) => g.id)).toEqual(['g1']);
  });

  it('skips the group when the polygon is outside its band', () => {
    expect(groupsMatching(s(), 1, 1700, 1900)).toEqual([]);
  });

  it('skips a hidden group', () => {
    expect(groupsMatching(updateGroup(s(), 'g1', { hidden: true }), 1, 900, 1000)).toEqual([]);
  });

  it('matches when the polygon has no elevation data', () => {
    expect(groupsMatching(s(), 1, null, null)).toHaveLength(1);
  });
});
