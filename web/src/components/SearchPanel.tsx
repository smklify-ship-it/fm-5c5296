import { useMemo, useState } from 'react';
import { searchLegends } from '../lib/search';
import type { Selection } from '../lib/style';
import type { Legend } from '../lib/types';

const MAX_RESULTS = 150;

interface Props {
  legends: Legend[];
  selected: Selection[];
  onToggle: (code: number) => void;
  onSelectMany: (codes: number[]) => void;
  onClear: () => void;
}

function elevText(l: Legend): string {
  return l.lo === null || l.hi === null ? '' : `${l.lo}–${l.hi}m`;
}

export function SearchPanel({ legends, selected, onToggle, onSelectMany, onClear }: Props) {
  const [query, setQuery] = useState('');
  const results = useMemo(() => searchLegends(legends, query), [legends, query]);
  const byCode = useMemo(() => new Map(legends.map((l) => [l.c, l])), [legends]);
  const colorOf = useMemo(() => new Map(selected.map((s) => [s.code, s.color])), [selected]);

  return (
    <div className="panel">
      {selected.length > 0 && (
        <div className="chips">
          {selected.map((s) => (
            <button key={s.code} className="chip" onClick={() => onToggle(s.code)} title="外す">
              <span className="swatch" style={{ background: s.color }} />
              {byCode.get(s.code)?.n ?? s.code} ×
            </button>
          ))}
          <button className="chip clear" onClick={onClear}>
            全部外す
          </button>
        </div>
      )}
      <input
        className="search"
        type="search"
        placeholder="群落名で検索（例: ミズナラ / あかまつ / ブナ ササ）"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
      />
      {query && (
        <div className="result-head">
          {results.length} 件
          {results.length > 0 && (
            <button onClick={() => onSelectMany(results.slice(0, MAX_RESULTS).map((l) => l.c))}>
              表示中をすべて選ぶ
            </button>
          )}
        </div>
      )}
      <ul className="results">
        {results.slice(0, MAX_RESULTS).map((l) => {
          const color = colorOf.get(l.c);
          return (
            <li key={l.c}>
              <label>
                <input type="checkbox" checked={color !== undefined} onChange={() => onToggle(l.c)} />
                <span className="swatch" style={{ background: color ?? 'transparent' }} />
                <span className="name">{l.n}</span>
                <span className="meta">
                  {l.k}・{l.count}区画 {elevText(l)}
                </span>
              </label>
            </li>
          );
        })}
      </ul>
      {!query && legends.length === 0 && (
        <p className="hint">「保存」タブで県のデータを端末に保存すると、群落名を検索できます。</p>
      )}
    </div>
  );
}
