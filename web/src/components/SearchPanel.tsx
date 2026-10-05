import { useMemo, useState } from 'react';
import * as G from '../lib/groups';
import { searchLegends } from '../lib/search';
import type { Selection } from '../lib/style';
import type { Legend } from '../lib/types';

const MAX_RESULTS = 150;
const INDIVIDUAL = ''; // <select> value for "not in a group"

type Update = (fn: (cur: G.SelectionState) => G.SelectionState) => void;

interface Props {
  legends: Legend[];
  sel: G.SelectionState;
  onChange: Update;
}

function elevText(l: Legend | undefined): string {
  return !l || l.lo === null || l.hi === null ? '' : `${l.lo}–${l.hi}m`;
}

function legendMeta(l: Legend | undefined): string {
  return l ? `${l.k}・${l.count}区画 ${elevText(l)}` : '';
}

/** "Move to" dropdown shared by member and individual rows. */
function MoveSelect({ sel, s, onChange }: { sel: G.SelectionState; s: Selection; onChange: Update }) {
  if (sel.groups.length === 0) return null;
  return (
    <select
      className="move"
      title="グループへ移す"
      value={s.group ?? INDIVIDUAL}
      onChange={(e) => onChange((cur) => G.assign(cur, s.code, e.target.value || null))}
    >
      <option value={INDIVIDUAL}>個別</option>
      {sel.groups.map((g) => (
        <option key={g.id} value={g.id}>
          {g.name}
        </option>
      ))}
    </select>
  );
}

interface RowProps {
  sel: G.SelectionState;
  s: Selection;
  legend: Legend | undefined;
  color: string;
  onChange: Update;
}

function SelectionRow({ sel, s, legend, color, onChange }: RowProps) {
  return (
    <li className={s.hidden ? 'is-hidden' : ''}>
      <label>
        <input
          type="checkbox"
          checked={!s.hidden}
          onChange={(e) => onChange((cur) => G.setHidden(cur, s.code, !e.target.checked))}
        />
        <span className="swatch" style={{ background: color }} />
        <span className="name">{legend?.n ?? s.code}</span>
        <span className="meta">{legendMeta(legend)}</span>
      </label>
      <MoveSelect sel={sel} s={s} onChange={onChange} />
      <button className="remove" title="選択から外す" onClick={() => onChange((cur) => G.remove(cur, s.code))}>
        ×
      </button>
    </li>
  );
}

interface GroupProps {
  sel: G.SelectionState;
  group: G.Group;
  byCode: Map<number, Legend>;
  editing: boolean;
  onEdit: (id: string | null) => void;
  onChange: Update;
}

function GroupBlock({ sel, group, byCode, editing, onEdit, onChange }: GroupProps) {
  const members = G.membersOf(sel, group.id);
  const commitName = (value: string) => {
    onChange((cur) => G.renameGroup(cur, group.id, value));
    onEdit(null);
  };
  const confirmDelete = () => {
    const msg = `グループ「${group.name}」を削除しますか？\n中の ${members.length} 群落も選択から外れます。`;
    if (confirm(msg)) onChange((cur) => G.deleteGroup(cur, group.id));
  };

  return (
    <li className={`group ${group.hidden ? 'is-hidden' : ''}`}>
      <div className="group-head">
        <input
          type="checkbox"
          title="グループごと表示／非表示"
          checked={!group.hidden}
          onChange={(e) => onChange((cur) => G.updateGroup(cur, group.id, { hidden: !e.target.checked }))}
        />
        <input
          type="color"
          className="color-pick"
          title="色を変える"
          value={group.color}
          onChange={(e) => onChange((cur) => G.updateGroup(cur, group.id, { color: e.target.value }))}
        />
        {editing ? (
          <input
            className="group-name-edit"
            defaultValue={group.name}
            autoFocus
            onBlur={(e) => commitName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') commitName(e.currentTarget.value);
              if (e.key === 'Escape') onEdit(null);
            }}
          />
        ) : (
          <button className="group-name" title="名前を変える" onClick={() => onEdit(group.id)}>
            {group.name}（{members.length}）✎
          </button>
        )}
        <button
          className="icon"
          title={group.collapsed ? '中身を開く' : '中身を閉じる'}
          onClick={() => onChange((cur) => G.updateGroup(cur, group.id, { collapsed: !group.collapsed }))}
        >
          {group.collapsed ? '▶' : '▼'}
        </button>
        <button className="icon danger" title="グループを削除" onClick={confirmDelete}>
          🗑
        </button>
      </div>
      {!group.collapsed && (
        <ul className="results members">
          {members.length === 0 && <li className="hint">空です。検索して「追加先」にこのグループを選んで追加してください。</li>}
          {members.map((s) => (
            <SelectionRow key={s.code} sel={sel} s={s} legend={byCode.get(s.code)} color={group.color} onChange={onChange} />
          ))}
        </ul>
      )}
    </li>
  );
}

export function SearchPanel({ legends, sel, onChange }: Props) {
  const [query, setQuery] = useState('');
  const [target, setTarget] = useState<G.Target>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const results = useMemo(() => searchLegends(legends, query), [legends, query]);
  const byCode = useMemo(() => new Map(legends.map((l) => [l.c, l])), [legends]);
  const resolved = useMemo(() => new Map(G.resolveForMap(sel).map((s) => [s.code, s])), [sel]);
  const groupName = useMemo(() => new Map(sel.groups.map((g) => [g.id, g.name])), [sel.groups]);
  // A deleted group cannot stay the add target.
  const effectiveTarget = target !== null && groupName.has(target) ? target : null;
  const shown = results.slice(0, MAX_RESULTS);

  const createFromResults = () => {
    const id = crypto.randomUUID();
    onChange((cur) => G.createGroup(cur, query, shown.map((l) => l.c), id));
    setQuery('');
  };
  const createEmpty = () => {
    const id = crypto.randomUUID();
    onChange((cur) => G.createGroup(cur, '', [], id));
    setTarget(id); // the next search adds straight into the new group
    setEditing(id);
  };

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
            <span>{results.length} 件</span>
            {sel.groups.length > 0 && (
              <label className="target">
                追加先
                <select
                  value={effectiveTarget ?? INDIVIDUAL}
                  onChange={(e) => setTarget(e.target.value || null)}
                >
                  <option value={INDIVIDUAL}>個別（1群落1色）</option>
                  {sel.groups.map((g) => (
                    <option key={g.id} value={g.id}>
                      {g.name}
                    </option>
                  ))}
                </select>
              </label>
            )}
          </div>
          {shown.length > 0 && (
            <div className="buttons">
              <button className="primary" onClick={createFromResults}>
                この結果でグループ作成
              </button>
              <button onClick={() => onChange((cur) => G.assignMany(cur, shown.map((l) => l.c), effectiveTarget))}>
                表示中をすべて追加
              </button>
            </div>
          )}
          <ul className="results">
            {shown.map((l) => {
              const r = resolved.get(l.c);
              const g = sel.selected.find((s) => s.code === l.c)?.group;
              return (
                <li key={l.c}>
                  <label>
                    <input
                      type="checkbox"
                      checked={r !== undefined}
                      onChange={() => onChange((cur) => G.toggle(cur, l.c, effectiveTarget))}
                    />
                    <span className="swatch" style={{ background: r?.color ?? 'transparent' }} />
                    <span className="name">{l.n}</span>
                    <span className="meta">
                      {legendMeta(l)}
                      {g ? `・${groupName.get(g)}` : ''}
                      {r?.hidden ? '・非表示中' : ''}
                    </span>
                  </label>
                </li>
              );
            })}
          </ul>
        </>
      ) : sel.selected.length + sel.groups.length > 0 ? (
        <>
          <div className="buttons">
            <button onClick={() => onChange((cur) => G.setAllHidden(cur, false))}>すべて表示</button>
            <button onClick={() => onChange((cur) => G.setAllHidden(cur, true))}>すべて隠す</button>
            <button onClick={createEmpty}>＋空のグループ</button>
            <button
              className="danger"
              onClick={() => confirm('グループも含めて、選択をすべて外しますか？') && onChange(() => G.EMPTY_STATE)}
            >
              全部外す
            </button>
          </div>
          {sel.groups.length > 0 && (
            <ul className="results groups">
              {sel.groups.map((g) => (
                <GroupBlock
                  key={g.id}
                  sel={sel}
                  group={g}
                  byCode={byCode}
                  editing={editing === g.id}
                  onEdit={setEditing}
                  onChange={onChange}
                />
              ))}
            </ul>
          )}
          {G.individuals(sel).length > 0 && (
            <>
              {sel.groups.length > 0 && <div className="result-head">個別</div>}
              <ul className="results">
                {G.individuals(sel).map((s) => (
                  <SelectionRow key={s.code} sel={sel} s={s} legend={byCode.get(s.code)} color={s.color} onChange={onChange} />
                ))}
              </ul>
            </>
          )}
        </>
      ) : legends.length > 0 ? (
        <>
          <p className="hint">
            群落名を検索してチェックすると地図に色付きで表示されます。「この結果でグループ作成」で、
            まとめて1色にできます。
          </p>
          <div className="buttons">
            <button onClick={createEmpty}>＋空のグループ</button>
          </div>
        </>
      ) : (
        <p className="hint">「保存」タブで県のデータを端末に保存すると、群落名を検索できます。</p>
      )}
    </div>
  );
}
