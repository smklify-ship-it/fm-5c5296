import type { Memo } from './types';

const XML_ESCAPES: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&apos;',
};

function escapeXml(text: string): string {
  return text.replace(/[&<>"']/g, (ch) => XML_ESCAPES[ch]);
}

function unescapeXml(text: string): string {
  return text
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&');
}

/** GPX 1.1 with one waypoint per memo (readable by ジオグラフィカ, Google Earth, QGIS). */
export function exportGpx(memos: Memo[]): string {
  const wpts = memos.map((m) => {
    const name = escapeXml(m.text.split('\n')[0] || 'memo');
    return [
      `  <wpt lat="${m.lat.toFixed(7)}" lon="${m.lon.toFixed(7)}">`,
      `    <time>${escapeXml(m.time)}</time>`,
      `    <name>${name}</name>`,
      `    <desc>${escapeXml(m.text)}</desc>`,
      '  </wpt>',
    ].join('\n');
  });
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<gpx version="1.1" creator="veg-map" xmlns="http://www.topografix.com/GPX/1/1">',
    ...wpts,
    '</gpx>',
    '',
  ].join('\n');
}

function tagText(block: string, tag: string): string | null {
  const m = new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`).exec(block);
  return m ? unescapeXml(m[1].trim()) : null;
}

function attr(openTag: string, name: string): number {
  const m = new RegExp(`${name}\\s*=\\s*["']([^"']+)["']`).exec(openTag);
  return m ? Number(m[1]) : Number.NaN;
}

/** Reads <wpt> elements only (tracks/routes are out of scope). Invalid points are skipped. */
export function parseGpx(xml: string, makeId: () => string): Memo[] {
  const memos: Memo[] = [];
  const re = /<wpt\b([^>]*)>([\s\S]*?)<\/wpt>/g;
  for (let m = re.exec(xml); m !== null; m = re.exec(xml)) {
    const lat = attr(m[1], 'lat');
    const lon = attr(m[1], 'lon');
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
    const text = tagText(m[2], 'desc') ?? tagText(m[2], 'name') ?? '';
    const time = tagText(m[2], 'time') ?? new Date().toISOString();
    memos.push({ id: makeId(), lat, lon, time, text });
  }
  return memos;
}
