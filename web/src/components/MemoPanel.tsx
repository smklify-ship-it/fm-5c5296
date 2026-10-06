import { useRef, useState } from 'react';
import { exportGpx, parseGpx } from '../lib/gpx';
import { exportFile } from '../lib/share';
import type { Memo } from '../lib/types';

const GPS_TIMEOUT_MS = 20_000;

interface Props {
  memos: Memo[];
  mapCenter: () => { lat: number; lon: number };
  onAdd: (m: Memo[]) => void;
  onDelete: (id: string) => void;
  onJump: (m: Memo) => void;
}

function getPosition(): Promise<GeolocationPosition> {
  return new Promise((resolve, reject) =>
    navigator.geolocation.getCurrentPosition(resolve, reject, {
      enableHighAccuracy: true,
      timeout: GPS_TIMEOUT_MS,
      maximumAge: 10_000,
    }),
  );
}

export function MemoPanel({ memos, mapCenter, onAdd, onDelete, onJump }: Props) {
  const [text, setText] = useState('');
  const [status, setStatus] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);

  const add = (lat: number, lon: number) => {
    onAdd([{ id: crypto.randomUUID(), lat, lon, time: new Date().toISOString(), text: text.trim() }]);
    setText('');
  };

  const addHere = async () => {
    setStatus('現在地を取得中…（圏外では時間がかかることがあります）');
    try {
      const pos = await getPosition();
      add(pos.coords.latitude, pos.coords.longitude);
      setStatus(`記録しました（誤差 約${Math.round(pos.coords.accuracy)}m）`);
    } catch (e) {
      const msg = e instanceof GeolocationPositionError ? e.message : String(e);
      setStatus(`現在地が取れませんでした: ${msg}。「地図の中心に記録」を使ってください`);
    }
  };

  const addCenter = () => {
    const c = mapCenter();
    add(c.lat, c.lon);
    setStatus('地図の中心（＋印）に記録しました');
  };

  const importGpx = async (file: File) => {
    try {
      const imported = parseGpx(await file.text(), () => crypto.randomUUID());
      onAdd(imported);
      setStatus(`${imported.length} 件を読み込みました`);
    } catch (e) {
      setStatus(`読み込めませんでした: ${String(e)}`);
    }
  };

  return (
    <div className="panel">
      <textarea
        placeholder="メモ（例: マイタケ 2株 ミズナラ大木の根元）"
        value={text}
        onChange={(e) => setText(e.target.value)}
        rows={2}
      />
      <div className="buttons">
        <button className="primary" onClick={addHere}>
          現在地に記録
        </button>
        <button onClick={addCenter}>地図の中心に記録</button>
      </div>
      {status && <p className="hint">{status}</p>}
      <ul className="memos">
        {[...memos]
          .sort((a, b) => b.time.localeCompare(a.time))
          .map((m) => (
            <li key={m.id}>
              <button className="link" onClick={() => onJump(m)}>
                {new Date(m.time).toLocaleString('ja-JP')} {m.text || '(メモなし)'}
              </button>
              <button
                onClick={() => {
                  if (confirm('このメモを削除しますか？')) onDelete(m.id);
                }}
              >
                削除
              </button>
            </li>
          ))}
      </ul>
      <div className="buttons">
        <button
          disabled={memos.length === 0}
          onClick={async () => {
            const name = `kinoko-memo-${new Date().toISOString().slice(0, 10)}.gpx`;
            const result = await exportFile(name, exportGpx(memos), 'application/gpx+xml');
            if (result === 'shared') setStatus('共有しました');
            if (result === 'downloaded') setStatus(`${name} を保存しました`);
          }}
        >
          GPXで書き出す
        </button>
        <button onClick={() => fileRef.current?.click()}>GPXを読み込む</button>
        <input
          ref={fileRef}
          type="file"
          accept=".gpx,application/gpx+xml,application/xml,text/xml"
          hidden
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) void importGpx(f);
            e.target.value = '';
          }}
        />
      </div>
    </div>
  );
}
