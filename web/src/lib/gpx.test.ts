import { describe, expect, it } from 'vitest';
import { exportGpx, parseGpx } from './gpx';
import type { Memo } from './types';

const memo: Memo = {
  id: 'a',
  lat: 36.5123456,
  lon: 138.9876543,
  time: '2026-10-04T01:23:45.000Z',
  text: 'マイタケ <2株> & ミズナラ\n根元',
};

let n = 0;
const makeId = () => `id${++n}`;

describe('exportGpx', () => {
  it('writes one wpt with lat/lon', () => {
    expect(exportGpx([memo])).toContain('<wpt lat="36.5123456" lon="138.9876543">');
  });

  it('escapes XML special characters', () => {
    expect(exportGpx([memo])).toContain('マイタケ &lt;2株&gt; &amp; ミズナラ');
  });

  it('uses the first memo line as the waypoint name', () => {
    expect(exportGpx([memo])).toContain('<name>マイタケ &lt;2株&gt; &amp; ミズナラ</name>');
  });
});

describe('parseGpx', () => {
  it('round-trips text through export and import', () => {
    expect(parseGpx(exportGpx([memo]), makeId)[0].text).toBe(memo.text);
  });

  it('round-trips coordinates', () => {
    const [m] = parseGpx(exportGpx([memo]), makeId);
    expect([m.lat, m.lon]).toEqual([memo.lat, memo.lon]);
  });

  it('reads waypoints written by other apps (name only, single quotes)', () => {
    const xml = "<gpx><wpt lon='139.1' lat='36.2'><name>山頂</name></wpt></gpx>";
    expect(parseGpx(xml, makeId)[0]).toMatchObject({ lat: 36.2, lon: 139.1, text: '山頂' });
  });

  it('skips waypoints without valid coordinates', () => {
    expect(parseGpx('<gpx><wpt lat="x" lon="1"><name>a</name></wpt></gpx>', makeId)).toEqual([]);
  });
});
