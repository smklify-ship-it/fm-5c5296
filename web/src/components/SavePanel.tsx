import { useEffect, useRef, useState } from 'react';
import {
  BASE_MAX_ZOOM,
  downloadBaseArea,
  estimateArea,
  MAX_TILES_PER_AREA,
  type DownloadProgress,
} from '../lib/basemap';
import { ALL_PARTS, type BackupParts } from '../lib/backup';
import { dbAll, dbClear, dbPut, STORES } from '../lib/db';
import { loadSetting, saveSetting } from '../lib/settings';
import type { BBox, PrefEntry, SavedArea } from '../lib/types';

const ZOOM_CHOICES = [14, 15, 16];

/** Shown in the 集約 section; produced by App's automatic sync. */
export interface SyncInfo {
  state: 'idle' | 'syncing' | 'synced' | 'offline' | 'error';
  at?: number;
  pushed?: number;
  uid?: string;
  anonymous?: boolean;
  owner?: boolean;
  ownerReadError?: string;
  message?: string;
}

const MB = 1e6;

interface Props {
  prefs: PrefEntry[];
  stored: Set<string>;
  hiddenPrefs: string[];
  onPrefVisible: (key: string, visible: boolean) => void;
  busyPref: { key: string; received: number; total: number } | null;
  onStorePref: (p: PrefEntry) => void;
  onRemovePref: (p: PrefEntry) => void;
  viewBbox: BBox | null;
  // Return a status line for the panel; throw with a user-facing message on failure.
  onExportBackup: (parts: BackupParts) => Promise<string>;
  onImportBackup: (file: File, parts: BackupParts) => Promise<string>;
  syncInfo: SyncInfo;
  onOwnerSignIn: () => Promise<string>;
  showOthers: boolean;
  onShowOthers: (v: boolean) => void;
}

function mb(bytes: number): string {
  return `${(bytes / MB).toFixed(1)} MB`;
}

export function SavePanel({
  prefs,
  stored,
  hiddenPrefs,
  onPrefVisible,
  busyPref,
  onStorePref,
  onRemovePref,
  viewBbox,
  onExportBackup,
  onImportBackup,
  syncInfo,
  onOwnerSignIn,
  showOthers,
  onShowOthers,
}: Props) {
  const [ownerError, setOwnerError] = useState('');
  const signInOwner = async () => {
    try {
      await onOwnerSignIn();
      setOwnerError('');
    } catch (e) {
      setOwnerError(`ログインできませんでした: ${e instanceof Error ? e.message : String(e)}`);
    }
  };
  const [backupStatus, setBackupStatus] = useState('');
  const [parts, setParts] = useState<BackupParts>(() => loadSetting('backupParts', ALL_PARTS));
  const setPart = (key: keyof BackupParts, on: boolean) => {
    const next = { ...parts, [key]: on };
    setParts(next);
    saveSetting('backupParts', next);
  };
  const noPart = !parts.memos && !parts.groups;
  const backupFileRef = useRef<HTMLInputElement>(null);
  const runBackup = async (task: () => Promise<string>) => {
    try {
      setBackupStatus(await task());
    } catch (e) {
      setBackupStatus(e instanceof Error ? e.message : String(e));
    }
  };
  const [maxZoom, setMaxZoom] = useState(BASE_MAX_ZOOM);
  const [areas, setAreas] = useState<SavedArea[]>([]);
  const [progress, setProgress] = useState<DownloadProgress | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [usage, setUsage] = useState<string>('');
  const abortRef = useRef<AbortController | null>(null);

  const refreshAreas = async () => {
    const [list, est] = await Promise.all([
      dbAll<SavedArea>(STORES.areas),
      navigator.storage?.estimate?.() ?? Promise.resolve(undefined),
    ]);
    setAreas(list);
    if (est) setUsage(`端末内の使用量 ${mb(est.usage ?? 0)}`);
  };
  useEffect(() => {
    let alive = true;
    Promise.all([dbAll<SavedArea>(STORES.areas), navigator.storage?.estimate?.()])
      .then(([list, est]) => {
        if (!alive) return;
        setAreas(list);
        if (est) setUsage(`端末内の使用量 ${mb(est.usage ?? 0)}`);
      })
      .catch((e: unknown) => alive && setError(String(e)));
    return () => {
      alive = false;
    };
  }, []);

  const estimate = viewBbox ? estimateArea(viewBbox, maxZoom) : null;
  const tooBig = estimate !== null && estimate.tiles > MAX_TILES_PER_AREA;

  const startDownload = async () => {
    if (!viewBbox) return;
    setError(null);
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    try {
      // Ask the browser not to evict offline data under storage pressure.
      await navigator.storage?.persist?.();
      const result = await downloadBaseArea(viewBbox, maxZoom, setProgress, ctrl.signal);
      const area: SavedArea = {
        id: crypto.randomUUID(),
        bbox: viewBbox,
        maxZoom,
        tiles: result.total,
        bytes: result.bytes,
        savedAt: new Date().toISOString(),
      };
      await dbPut(STORES.areas, area.id, area);
      await refreshAreas();
    } catch (e) {
      setError(e instanceof DOMException && e.name === 'AbortError' ? '中止しました' : String(e));
    } finally {
      setProgress(null);
      abortRef.current = null;
    }
  };

  const clearAreas = async () => {
    if (!confirm('保存した背景地図をすべて削除しますか？（植生データは残ります）')) return;
    await dbClear(STORES.tiles);
    await dbClear(STORES.areas);
    await refreshAreas();
  };

  return (
    <div className="panel">
      <h3>① 県の植生データ</h3>
      <p className="hint">
        表示する県を端末に保存します（一度だけ。圏外でも使えます）。保存した県はチェックで地図への表示を切り替えられます（データは消えません）。
      </p>
      <ul className="prefs">
        {prefs.map((p) => {
          const isStored = stored.has(p.key);
          const busy = busyPref?.key === p.key;
          return (
            <li key={p.key}>
              {isStored ? (
                <label className="pref-name" title="地図に表示する／しない">
                  <input
                    type="checkbox"
                    checked={!hiddenPrefs.includes(p.key)}
                    onChange={(e) => onPrefVisible(p.key, e.target.checked)}
                  />
                  {p.name}（{mb(p.vegBytes + p.kokuyuBytes)}・{p.built}）
                </label>
              ) : (
                <span>
                  {p.name}（{mb(p.vegBytes + p.kokuyuBytes)}・{p.built}）
                </span>
              )}
              {busy ? (
                <span>
                  保存中 {Math.floor(((busyPref?.received ?? 0) / (busyPref?.total || 1)) * 100)}%
                </span>
              ) : isStored ? (
                <button onClick={() => onRemovePref(p)}>削除</button>
              ) : (
                <button className="primary" onClick={() => onStorePref(p)} disabled={busyPref !== null}>
                  保存
                </button>
              )}
            </li>
          );
        })}
      </ul>

      <h3>② 背景地図（等高線）をオフライン用に保存</h3>
      <p className="hint">このパネルの上に見えている地図の範囲を保存します。出発前に、行く山がその範囲に入るよう地図を動かしてから押してください。</p>
      <label className="row">
        細かさ
        <select value={maxZoom} onChange={(e) => setMaxZoom(Number(e.target.value))}>
          {ZOOM_CHOICES.map((z) => (
            <option key={z} value={z}>
              {z === BASE_MAX_ZOOM ? `${z}（最も詳しい）` : z}
            </option>
          ))}
        </select>
      </label>
      {estimate && (
        <p className={tooBig ? 'warn' : 'hint'}>
          約 {estimate.tiles} 枚・最大 {mb(estimate.bytes)} の見込み
          {tooBig && `。範囲が広すぎます（上限 ${MAX_TILES_PER_AREA} 枚）。拡大するか細かさを下げてください`}
        </p>
      )}
      {progress ? (
        <div>
          <progress value={progress.done} max={progress.total} /> {progress.done}/{progress.total}
          <button onClick={() => abortRef.current?.abort()}>中止</button>
        </div>
      ) : (
        <button className="primary" disabled={!viewBbox || tooBig} onClick={startDownload}>
          この範囲を保存
        </button>
      )}
      {error && <p className="warn">{error}</p>}
      {areas.length > 0 && (
        <>
          <ul className="areas">
            {areas.map((a) => (
              <li key={a.id}>
                {a.savedAt.slice(0, 10)}・{a.tiles}枚・{mb(a.bytes)}（細かさ{a.maxZoom}）
              </li>
            ))}
          </ul>
          <button onClick={clearAreas}>保存した背景地図をすべて削除</button>
        </>
      )}

      <h3>③ バックアップ（メモ・グループ）</h3>
      <p className="hint">
        発見地点メモ、グループ（群落・色・標高帯・時期）、個別に選んだ群落を1つのファイルに書き出します。
        読み込みは置き換えではなく統合です（同じものは新しい方を残す）。他の端末のバックアップも読み込めます。
        下のチェックは書き出し・読み込みの両方に効きます。
      </p>
      <label className="row">
        <input type="checkbox" checked={parts.memos} onChange={(e) => setPart('memos', e.target.checked)} />
        発見地点メモ
      </label>
      <label className="row">
        <input type="checkbox" checked={parts.groups} onChange={(e) => setPart('groups', e.target.checked)} />
        グループ（個別に選んだ群落も含む）
      </label>
      <div className="buttons">
        <button className="primary" disabled={noPart} onClick={() => void runBackup(() => onExportBackup(parts))}>
          書き出す
        </button>
        <button disabled={noPart} onClick={() => backupFileRef.current?.click()}>
          読み込む
        </button>
        <input
          ref={backupFileRef}
          type="file"
          accept=".json,application/json"
          hidden
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) void runBackup(() => onImportBackup(f, parts));
            e.target.value = '';
          }}
        />
      </div>
      {backupStatus && <p className="hint">{backupStatus}</p>}

      {/* Sync runs silently; the owner only gets the switch for other devices' memos. */}
      {syncInfo.owner && (
        <label className="row">
          <input type="checkbox" checked={showOthers} onChange={(e) => onShowOthers(e.target.checked)} />
          ほかの端末の発見地点を表示
        </label>
      )}
      <p className="hint">{usage}</p>
      {syncInfo.anonymous === true && (
        <details className="owner">
          <summary>プログラム修正</summary>
          <button onClick={() => void signInOwner()}>Googleでログイン</button>
        </details>
      )}
      {ownerError && <p className="warn">{ownerError}</p>}
    </div>
  );
}
