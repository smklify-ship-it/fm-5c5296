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
  focus: string | null;
  onFocus: (id: string | null) => void;
  seasonOnly: boolean;
  onSeasonOnly: (v: boolean) => void;
  month: number;
}

function elevText(l: Legend | undefined): string {
  return !l || l.lo === null || l.hi === null ? '' : `${l.lo}–${l.hi}m`;
}

function legendMeta(l: Legend | undefined): string {
  return l ? `${l.k}・${l.count}区画 ${elevText(l)}` : '';
}

interface RowProps {
  s: Selection;
  legend: Legend | undefined;
  color: string;
  onChange: Update;
}

function SelectionRow({ s, legend, color, onChange }: RowProps) {
  return (
    <li className={s.hidden ? 'is-hidden' : ''}>
      <label>
        <input
          type="checkbox"
          checked={!s.hidden}
          onChange={(e) => onChange((cur) => G.setHidden(cur, s.code, s.group, !e.target.checked))}
        />
        <span className="swatch" style={{ background: color }} />
        <span className="name">{legend?.n ?? s.code}</span>
        <span className="meta">{legendMeta(legend)}</span>
      </label>
      <button
        className="remove"
        title={s.group ? 'このグループから外す' : '選択から外す'}
        onClick={() => onChange((cur) => G.remove(cur, s.code, s.group))}
      >
        ×
      </button>
    </li>
  );
}

const MONTHS = Array.from({ length: 12 }, (_, i) => i + 1);

/** Mushroom conditions of a group: own elevation band and fruiting months (both optional). */
function ConditionEditor({ group, onChange }: { group: G.Group; onChange: Update }) {
  // Text state so a half-typed number is not normalised away while typing.
  const [lo, setLo] = useState(group.elev ? String(group.elev[0]) : '');
  const [hi, setHi] = useState(group.elev ? String(group.elev[1]) : '');
  const toNum = (v: string) => (v.trim() === '' ? null : Number(v));
  const commitBand = () => {
    const band = G.makeBand(toNum(lo), toNum(hi));
    // Both ends empty clears the band; one end empty keeps the previous band.
    if (!band && (lo.trim() !== '' || hi.trim() !== '')) return;
    onChange((cur) => G.updateGroup(cur, group.id, { elev: band }));
    if (band) {
      setLo(String(band[0]));
      setHi(String(band[1]));
    }
  };
  const toggleMonth = (m: number) => {
    const cur = group.months ?? [];
    const next = cur.includes(m) ? cur.filter((x) => x !== m) : [...cur, m].sort((a, b) => a - b);
    onChange((st) => G.updateGroup(st, group.id, { months: next.length > 0 ? next : undefined }));
  };
  return (
    <div className="conditions">
      <div className="cond-row">
        <span className="cond-label">標高</span>
        <input
          className="num"
          inputMode="numeric"
          placeholder="下限"
          value={lo}
          onChange={(e) => setLo(e.target.value)}
          onBlur={commitBand}
          onKeyDown={(e) => e.key === 'Enter' && commitBand()}
        />
        〜
        <input
          className="num"
          inputMode="numeric"
          placeholder="上限"
          value={hi}
          onChange={(e) => setHi(e.target.value)}
          onBlur={commitBand}
          onKeyDown={(e) => e.key === 'Enter' && commitBand()}
        />
        m
        {group.elev && (
          <button
            className="link small"
            onClick={() => {
              setLo('');
              setHi('');
              onChange((cur) => G.updateGroup(cur, group.id, { elev: undefined }));
            }}
          >
            なし
          </button>
        )}
      </div>
      <div className="cond-row">
        <span className="cond-label">時期</span>
        <div className="months">
          {MONTHS.map((m) => (
            <button
              key={m}
              className={`month ${group.months?.includes(m) ? 'on' : ''}`}
              aria-pressed={group.months?.includes(m) ?? false}
              onClick={() => toggleMonth(m)}
            >
              {m}
            </button>
          ))}
        </div>
      </div>
      <p className="hint">
        標高を入れると、このグループは全体の標高設定ではなくこの標高帯で絞り込みます（区画単位）。
        🎯注目にすると、地形のマスク／強調もこの標高帯になります。
      </p>
    </div>
  );
}

interface GroupProps {
  sel: G.SelectionState;
  group: G.Group;
  byCode: Map<number, Legend>;
  editing: boolean;
  onEdit: (id: string | null) => void;
  onChange: Update;
  focused: boolean;
  onFocus: (id: string | null) => void;
  offSeason: boolean;
}

function GroupBlock({ sel, group, byCode, editing, onEdit, onChange, focused, onFocus, offSeason }: GroupProps) {
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
    <li className={`group ${group.hidden || offSeason ? 'is-hidden' : ''}`}>
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
            {(G.conditionText(group) || offSeason) && (
              <span className="cond-summary">
                {G.conditionText(group)}
                {offSeason ? '・時期外' : ''}
              </span>
            )}
          </button>
        )}
        <button
          className={`icon focus ${focused ? 'on' : ''}`}
          title={focused ? '注目を解除' : 'このグループの標高帯で地形をマスク／強調'}
          aria-pressed={focused}
          disabled={!group.elev && !focused}
          onClick={() => onFocus(focused ? null : group.id)}
        >
          🎯
        </button>
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
      {!group.collapsed && <ConditionEditor group={group} onChange={onChange} />}
      {!group.collapsed && (
        <ul className="results members">
          {members.length === 0 && <li className="hint">空です。検索して「追加先」にこのグループを選んで追加してください。</li>}
          {members.map((s) => (
            <SelectionRow key={s.code} s={s} legend={byCode.get(s.code)} color={group.color} onChange={onChange} />
          ))}
        </ul>
      )}
    </li>
  );
}

export function SearchPanel({
  legends,
  sel,
  onChange,
  focus,
  onFocus,
  seasonOnly,
  onSeasonOnly,
  month,
}: Props) {
  const [query, setQuery] = useState('');
  const [target, setTarget] = useState<G.Target>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const results = useMemo(() => searchLegends(legends, query), [legends, query]);
  const byCode = useMemo(() => new Map(legends.map((l) => [l.c, l])), [legends]);
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
              // The checkbox reflects membership in the chosen 追加先 only.
              const entry = sel.selected.find(
                (s) => s.code === l.c && (s.group ?? null) === effectiveTarget,
              );
              const swatch = entry ? G.entryColor(sel, entry) : 'transparent';
              const where = [
                ...(sel.selected.some((s) => s.code === l.c && !s.group) ? ['個別'] : []),
                ...G.groupNamesOf(sel, l.c),
              ];
              return (
                <li key={l.c}>
                  <label>
                    <input
                      type="checkbox"
                      checked={entry !== undefined}
                      onChange={() => onChange((cur) => G.toggle(cur, l.c, effectiveTarget))}
                    />
                    <span className="swatch" style={{ background: swatch }} />
                    <span className="name">{l.n}</span>
                    <span className="meta">
                      {legendMeta(l)}
                      {where.length > 0 ? `・${where.join('・')}` : ''}
                      {entry?.hidden ? '・非表示中' : ''}
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
            <label className="row season">
              <input type="checkbox" checked={seasonOnly} onChange={(e) => onSeasonOnly(e.target.checked)} />
              今が旬のグループだけ表示（今は{month}月。時期を入れていないグループは常に表示）
            </label>
          )}
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
                  focused={focus === g.id}
                  onFocus={onFocus}
                  offSeason={seasonOnly && !G.inSeason(g, month)}
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
                  <SelectionRow key={s.code} s={s} legend={byCode.get(s.code)} color={s.color} onChange={onChange} />
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
