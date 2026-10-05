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
  onSetHidden: (code: number, hidden: boolean) => void;
  onSetAllHidden: (hidden: boolean) => void;
  onClear: () => void;
}

function elevText(l: Legend | undefined): string {
  return !l || l.lo === null || l.hi === null ? '' : `${l.lo}–${l.hi}m`;
}

export function SearchPanel({
  legends,
  selected,
  onToggle,
  onSelectMany,
  onSetHidden,
  onSetAllHidden,
  onClear,
}: Props) {
  const [query, setQuery] = useState('');
  const results = useMemo(() => searchLegends(legends, query), [legends, query]);
  const byCode = useMemo(() => new Map(legends.map((l) => [l.c, l])), [legends]);
  const selectionOf = useMemo(() => new Map(selected.map((s) => [s.code, s])), [selected]);

  return (
    <div className="panel">
      <input
        className="search"
        type="search"
        placeholder="群落名で検索して追加（例: ミズナラ / あかまつ / ブナ ササ）"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
      />

      {query ? (
        <>
          <div className="result-head">
            {results.length} 件（チェックで選択に追加）
            {results.length > 0 && (
              <button onClick={() => onSelectMany(results.slice(0, MAX_RESULTS).map((l) => l.c))}>
                表示中をすべて選ぶ
              </button>
            )}
          </div>
          <ul className="results">
            {results.slice(0, MAX_RESULTS).map((l) => {
              const sel = selectionOf.get(l.c);
              return (
                <li key={l.c}>
                  <label>
                    <input type="checkbox" checked={sel !== undefined} onChange={() => onToggle(l.c)} />
                    <span className="swatch" style={{ background: sel?.color ?? 'transparent' }} />
                    <span className="name">{l.n}</span>
                    <span className="meta">
                      {l.k}・{l.count}区画 {elevText(l)}
                      {sel?.hidden ? '・非表示中' : ''}
                    </span>
                  </label>
                </li>
              );
            })}
          </ul>
        </>
      ) : selected.length > 0 ? (
        <>
          <div className="result-head">
            選択中の群落 {selected.length} 件（チェックで表示を切替）
          </div>
          <div className="buttons">
            <button onClick={() => onSetAllHidden(false)}>すべて表示</button>
            <button onClick={() => onSetAllHidden(true)}>すべて隠す</button>
            <button className="danger" onClick={() => confirm('選択中の群落をすべて外しますか？') && onClear()}>
              全部外す
            </button>
          </div>
          <ul className="results">
            {selected.map((s) => {
              const legend = byCode.get(s.code);
              return (
                <li key={s.code} className={s.hidden ? 'is-hidden' : ''}>
                  <label>
                    <input
                      type="checkbox"
                      checked={!s.hidden}
                      onChange={(e) => onSetHidden(s.code, !e.target.checked)}
                    />
                    <span className="swatch" style={{ background: s.color }} />
                    <span className="name">{legend?.n ?? s.code}</span>
                    <span className="meta">
                      {legend ? `${legend.k}・${legend.count}区画 ${elevText(legend)}` : ''}
                    </span>
                  </label>
                  <button className="remove" title="選択から外す" onClick={() => onToggle(s.code)}>
                    ×
                  </button>
                </li>
              );
            })}
          </ul>
        </>
      ) : legends.length > 0 ? (
        <p className="hint">群落名を検索してチェックすると、地図に色付きで表示されます。</p>
      ) : (
        <p className="hint">「保存」タブで県のデータを端末に保存すると、群落名を検索できます。</p>
      )}
    </div>
  );
}
