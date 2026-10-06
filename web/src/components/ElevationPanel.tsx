import { DIRECTIONS } from '../lib/aspect';
import type { AspectSetting, ElevationMode, ElevationRange } from '../lib/types';

// Compass layout (3×3, centre empty) → index into DIRECTIONS.
const COMPASS: (number | null)[] = [7, 0, 1, 6, null, 2, 5, 4, 3];

const MIN_M = 0;
const MAX_M = 3200;
const STEP_M = 50;
const MODES: [ElevationMode, string][] = [
  ['mask', 'マスク（帯の外を灰色で隠す）'],
  ['highlight', '強調（帯の中を黄色で塗る）'],
  ['none', '区画の絞り込みだけ'],
];

interface Props {
  elev: ElevationRange;
  onChange: (e: ElevationRange) => void;
  showKokuyu: boolean;
  onShowKokuyu: (v: boolean) => void;
  // A focused mushroom group overrides the band used to shade the terrain.
  focus: { name: string; band: [number, number] } | null;
  onClearFocus: () => void;
  aspect: AspectSetting;
  onAspect: (a: AspectSetting) => void;
}

export function ElevationPanel({
  elev,
  onChange,
  showKokuyu,
  onShowKokuyu,
  focus,
  onClearFocus,
  aspect,
  onAspect,
}: Props) {
  const toggleDir = (i: number) =>
    onAspect({ ...aspect, allowed: aspect.allowed.map((v, j) => (j === i ? !v : v)) });
  const setMin = (v: number) => onChange({ ...elev, min: Math.min(v, elev.max) });
  const setMax = (v: number) => onChange({ ...elev, max: Math.max(v, elev.min) });
  const mode = elev.mode ?? 'mask';
  return (
    <div className="panel">
      {focus && (
        <div className="focus-note">
          🎯 注目中: {focus.name}（{focus.band[0]}–{focus.band[1]}m）。地形のマスク／強調はこの標高帯で
          表示しています。
          <button onClick={onClearFocus}>注目を解除</button>
        </div>
      )}
      <label className="row">
        <input
          type="checkbox"
          checked={elev.enabled}
          onChange={(e) => onChange({ ...elev, enabled: e.target.checked })}
        />
        標高で絞り込む
      </label>
      <div className={elev.enabled ? '' : 'disabled'}>
        <div className="elev-value">
          {elev.min} m 〜 {elev.max} m
        </div>
        <label className="slider">
          下限
          <input
            type="range"
            min={MIN_M}
            max={MAX_M}
            step={STEP_M}
            value={elev.min}
            disabled={!elev.enabled}
            onChange={(e) => setMin(Number(e.target.value))}
          />
        </label>
        <label className="slider">
          上限
          <input
            type="range"
            min={MIN_M}
            max={MAX_M}
            step={STEP_M}
            value={elev.max}
            disabled={!elev.enabled}
            onChange={(e) => setMax(Number(e.target.value))}
          />
        </label>
        <div className="modes" role="radiogroup" aria-label="地形の表示">
          {MODES.map(([value, label]) => (
            <label key={value} className="row">
              <input
                type="radio"
                name="elev-mode"
                checked={mode === value}
                disabled={!elev.enabled}
                onChange={() => onChange({ ...elev, mode: value })}
              />
              {label}
            </label>
          ))}
        </div>
        <p className="hint">
          植生は「区画の一部でもこの標高帯にかかれば」表示します。マスク／強調は地形そのもの
          （約15m間隔の標高）で塗り分けるので、帯の外にはみ出した部分が分かります。
          海や標高データが無い所はマスクでは灰色になります。
        </p>
      </div>
      <hr />
      <label className="row">
        <input
          type="checkbox"
          checked={aspect.enabled}
          onChange={(e) => onAspect({ ...aspect, enabled: e.target.checked })}
        />
        斜面の向きで絞り込む
      </label>
      <div className={`compass ${aspect.enabled ? '' : 'disabled'}`}>
        {COMPASS.map((i, k) =>
          i === null ? (
            <span key={k} className="compass-centre">
              ⊕
            </span>
          ) : (
            <button
              key={k}
              className={`dir ${aspect.allowed[i] ? 'on' : ''}`}
              aria-pressed={aspect.allowed[i]}
              disabled={!aspect.enabled}
              onClick={() => toggleDir(i)}
            >
              {DIRECTIONS[i]}
            </button>
          ),
        )}
      </div>
      <p className="hint">
        選んだ向きの斜面だけを見せ、それ以外を灰色で隠します（標高の帯と組み合わせ可）。平らな所は隠しません。
        地図を拡大し、左下の縮尺が300m程度になると表示されます。
      </p>
      <hr />
      <label className="row">
        <input type="checkbox" checked={showKokuyu} onChange={(e) => onShowKokuyu(e.target.checked)} />
        国有林の境界を表示（茶色の破線）
      </label>
      <p className="hint">国有林データは2018年4月時点。入林・採取のルールは各森林管理署に確認してください。</p>
    </div>
  );
}
