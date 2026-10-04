import type { ElevationRange } from '../lib/types';

const MIN_M = 0;
const MAX_M = 3200;
const STEP_M = 50;

interface Props {
  elev: ElevationRange;
  onChange: (e: ElevationRange) => void;
  showKokuyu: boolean;
  onShowKokuyu: (v: boolean) => void;
}

export function ElevationPanel({ elev, onChange, showKokuyu, onShowKokuyu }: Props) {
  const setMin = (v: number) => onChange({ ...elev, min: Math.min(v, elev.max) });
  const setMax = (v: number) => onChange({ ...elev, max: Math.max(v, elev.min) });
  return (
    <div className="panel">
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
        <p className="hint">
          区画の一部でもこの標高帯にかかれば表示します（区画は分割しません）。
          標高差の大きい区画は帯の外まで色が付くので、等高線で確かめてください。
        </p>
      </div>
      <hr />
      <label className="row">
        <input type="checkbox" checked={showKokuyu} onChange={(e) => onShowKokuyu(e.target.checked)} />
        国有林の境界を表示（茶色の破線）
      </label>
      <p className="hint">国有林データは2018年4月時点。入林・採取のルールは各森林管理署に確認してください。</p>
    </div>
  );
}
