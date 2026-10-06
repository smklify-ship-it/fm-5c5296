import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AttributionControl,
  GeolocateControl,
  Map as MlMap,
  Marker,
  NavigationControl,
  Popup,
  ScaleControl,
  type MapGeoJSONFeature,
} from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { ElevationPanel } from './components/ElevationPanel';
import { MemoPanel } from './components/MemoPanel';
import { SavePanel } from './components/SavePanel';
import { SearchPanel } from './components/SearchPanel';
import * as B from './lib/backup';
import { loadBaseStyle } from './lib/basemap';
import { exportFile } from './lib/share';
import { registerPatternFactory } from './lib/patterns';
import { dbAll, dbPut, STORES } from './lib/db';
import {
  addElevationLayer,
  addPrefLayers,
  applyElevationBand,
  applyKokuyuVisibility,
  applyVegStyle,
  hitLayerIds,
  removePrefLayers,
} from './lib/mapLayers';
import { mergeLegends } from './lib/search';
import { loadSetting, saveSetting } from './lib/settings';
import * as G from './lib/groups';
import type { BBox, ElevationRange, Memo, PrefEntry } from './lib/types';
import { attachPref, fetchPrefIndex, isPrefStored, removePref, storePref } from './lib/vegsource';

type Tab = 'veg' | 'elev' | 'save' | 'memo';
// Panel height on phones. Fixed per size (not content-driven) so switching tabs never
// resizes the map; the panel content scrolls instead.
type SheetSize = 's' | 'm' | 'l';
const SHEET_SIZES: SheetSize[] = ['s', 'm', 'l'];
const SHEET_LABEL: Record<SheetSize, string> = { s: '小', m: '中', l: '大' };
const TABS: [Tab, string][] = [
  ['veg', '群落'],
  ['elev', '標高・国有林'],
  ['save', '保存'],
  ['memo', 'メモ'],
];

interface View {
  center: [number, number];
  zoom: number;
}
// Central Gunma: the user's home area.
const DEFAULT_VIEW: View = { center: [138.95, 36.55], zoom: 9 };
const DEFAULT_ELEV: ElevationRange = { enabled: false, min: 800, max: 1600 };

const ATTRIBUTION = [
  '<a href="https://www.geospatial.jp/ckan/dataset/biodic_veg2024" target="_blank">「現存植生図2024」(環境省生物多様性センター)</a>を加工して作成',
  '<a href="https://nlftp.mlit.go.jp/ksj/" target="_blank">「国土数値情報（国有林野データ）」(国土交通省)</a>をもとに作成',
  '標高: <a href="https://maps.gsi.go.jp/development/ichiran.html" target="_blank">地理院タイル（標高タイル）</a>を加工',
  '県境: <a href="https://nlftp.mlit.go.jp/ksj/" target="_blank">「国土数値情報（行政区域データ）」(国土交通省)</a>をもとに作成',
];

function featureHtml(features: MapGeoJSONFeature[], mushrooms: G.Group[]): HTMLElement {
  const box = document.createElement('div');
  box.className = 'popup';
  const veg = features.find((f) => f.sourceLayer === 'veg');
  const kok = features.find((f) => f.sourceLayer === 'kokuyu');
  const line = (text: string, cls = '') => {
    const p = document.createElement('div');
    p.textContent = text;
    if (cls) p.className = cls;
    box.appendChild(p);
  };
  if (veg) {
    const p = veg.properties;
    line(String(p.n), 'popup-title');
    line(String(p.k), 'popup-sub');
    if (p.lo !== undefined && p.hi !== undefined) {
      line(`標高 ${p.lo}–${p.hi}m（平均 ${p.av}m）`);
    }
  }
  for (const g of mushrooms) {
    const cond = G.conditionText(g);
    line(`該当: ${g.name}${cond ? `（${cond}）` : ''}`, 'popup-match');
  }
  if (kok) {
    const p = kok.properties;
    line(`国有林: ${p.name ?? ''} ${p.han ?? ''} ${p.sp ?? ''}`.trim(), 'popup-kok');
  }
  return box;
}

export default function App() {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MlMap | null>(null);
  const attachedRef = useRef<Set<string>>(new Set());
  const [mapReady, setMapReady] = useState(false);
  const [fatal, setFatal] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const [prefs, setPrefs] = useState<PrefEntry[]>([]);
  const [stored, setStored] = useState<Set<string>>(new Set());
  const [attached, setAttached] = useState<Set<string>>(new Set());
  const [busyPref, setBusyPref] = useState<{ key: string; received: number; total: number } | null>(null);

  // Selections and colour groups live in one state so a move between them is atomic.
  const [sel, setSel] = useState<G.SelectionState>(() =>
    G.normalize({
      selected: loadSetting('selected', []),
      groups: loadSetting('groups', []),
      tombstones: loadSetting('groupTombstones', []),
    }),
  );
  const [elev, setElev] = useState<ElevationRange>(() => loadSetting('elev', DEFAULT_ELEV));
  const [showKokuyu, setShowKokuyu] = useState<boolean>(() => loadSetting('kokuyu', false));
  const [seasonOnly, setSeasonOnly] = useState<boolean>(() => loadSetting('seasonOnly', false));
  // Group whose band drives the terrain mask/highlight (only one band can shade the terrain).
  const [focus, setFocus] = useState<string | null>(() => loadSetting('focus', null));
  const [memos, setMemos] = useState<Memo[]>([]);
  // Deleted memos are kept as tombstones (see deleteMemo); only live ones are shown.
  const liveMemos = useMemo(() => memos.filter((m) => !m.deleted), [memos]);
  const [tab, setTab] = useState<Tab | null>(null);
  const [sheetSize, setSheetSize] = useState<SheetSize>(() => loadSetting('sheetSize', 'm'));
  const [viewBbox, setViewBbox] = useState<BBox | null>(null);
  const [online, setOnline] = useState(navigator.onLine);

  useEffect(() => {
    saveSetting('selected', sel.selected);
    saveSetting('groups', sel.groups);
    saveSetting('groupTombstones', sel.tombstones ?? []);
  }, [sel]);
  useEffect(() => saveSetting('elev', elev), [elev]);
  useEffect(() => saveSetting('kokuyu', showKokuyu), [showKokuyu]);
  useEffect(() => saveSetting('seasonOnly', seasonOnly), [seasonOnly]);
  useEffect(() => saveSetting('focus', focus), [focus]);
  useEffect(() => saveSetting('sheetSize', sheetSize), [sheetSize]);

  useEffect(() => {
    const update = () => setOnline(navigator.onLine);
    window.addEventListener('online', update);
    window.addEventListener('offline', update);
    return () => {
      window.removeEventListener('online', update);
      window.removeEventListener('offline', update);
    };
  }, []);

  const storedPrefs = useMemo(() => prefs.filter((p) => stored.has(p.key)), [prefs, stored]);
  const legends = useMemo(() => mergeLegends(storedPrefs), [storedPrefs]);

  // Every change stamps groups whose shared content changed, so merges and sync keep the
  // newest version.
  const updateSel = useCallback((fn: (cur: G.SelectionState) => G.SelectionState) => {
    setSel((cur) => G.stampChanged(cur, fn(cur), Date.now()));
  }, []);
  const toggleCode = useCallback(
    (code: number) => updateSel((cur) => G.toggle(cur, code, null)),
    [updateSel],
  );
  const month = new Date().getMonth() + 1;
  const view = useMemo<G.ViewOptions>(() => ({ seasonOnly, month }), [seasonOnly, month]);
  const entries = useMemo(() => G.drawEntries(sel, view), [sel, view]);
  // Legends drawn by several groups are striped where the groups' conditions overlap.
  const hasOverlap = useMemo(() => G.sharedCodes(entries).size > 0, [entries]);
  const focusGroup = sel.groups.find((g) => g.id === focus) ?? null;
  // A focused group with its own band shades the terrain with that band; otherwise the
  // global elevation setting does.
  const terrainBand = useMemo<ElevationRange>(() => {
    if (!focusGroup?.elev) return elev;
    const mode = elev.mode && elev.mode !== 'none' ? elev.mode : 'mask';
    return { enabled: true, min: focusGroup.elev[0], max: focusGroup.elev[1], mode };
  }, [focusGroup, elev]);
  // The map click handler is registered once, so it reads the latest state through refs.
  const selRef = useRef(sel);
  const viewRef = useRef(view);
  useEffect(() => {
    selRef.current = sel;
    viewRef.current = view;
  }, [sel, view]);

  // --- map bootstrap -------------------------------------------------------
  useEffect(() => {
    let disposed = false;
    const view = loadSetting<View>('view', DEFAULT_VIEW);
    (async () => {
      const style = await loadBaseStyle();
      if (disposed || !containerRef.current) return;
      const map = new MlMap({
        container: containerRef.current,
        style,
        center: view.center,
        zoom: view.zoom,
        maxZoom: 18,
        attributionControl: false,
      });
      mapRef.current = map;
      registerPatternFactory(map);
      // ?debug exposes the map to browser tests (layer/feature checks); never set otherwise.
      if (new URLSearchParams(location.search).has('debug')) {
        (window as unknown as { __map?: MlMap }).__map = map;
      }
      map.addControl(new AttributionControl({ compact: true, customAttribution: ATTRIBUTION }));
      map.addControl(new NavigationControl({ showCompass: true }), 'top-right');
      map.addControl(
        new GeolocateControl({
          positionOptions: { enableHighAccuracy: true },
          trackUserLocation: true,
          showAccuracyCircle: true,
        }),
        'top-right',
      );
      map.addControl(new ScaleControl({ unit: 'metric' }), 'bottom-left');

      const updateView = () => {
        const b = map.getBounds();
        setViewBbox([b.getWest(), b.getSouth(), b.getEast(), b.getNorth()]);
        const c = map.getCenter();
        saveSetting('view', { center: [c.lng, c.lat], zoom: map.getZoom() } satisfies View);
      };
      map.on('moveend', updateView);
      // Opening/closing the panel resizes the map, which changes the area "この範囲を保存" saves.
      map.on('resize', updateView);
      map.on('load', () => {
        updateView();
        // The attribution is long; start it collapsed (ⓘ) so it does not cover the map on phones.
        containerRef.current
          ?.querySelector('.maplibregl-ctrl-attrib')
          ?.classList.remove('maplibregl-compact-show');
        addElevationLayer(map);
        setMapReady(true);
      });
      map.on('error', (e) => console.error('map error', e.error));
      map.on('click', (e) => {
        const keys = [...attachedRef.current];
        const layers = hitLayerIds(map, keys);
        if (layers.length === 0) return;
        const features = map.queryRenderedFeatures(e.point, { layers });
        if (features.length === 0) return;
        const veg = features.find((f) => f.sourceLayer === 'veg');
        const num = (v: unknown) => (typeof v === 'number' ? v : null);
        const mushrooms = veg
          ? G.groupsMatching(
              selRef.current,
              Number(veg.properties.c),
              num(veg.properties.lo),
              num(veg.properties.hi),
              viewRef.current,
            )
          : [];
        const content = featureHtml(features, mushrooms);
        if (veg) {
          const code = Number(veg.properties.c);
          const btn = document.createElement('button');
          btn.textContent = 'この群落を選ぶ / 外す';
          btn.onclick = () => toggleCode(code);
          content.appendChild(btn);
        }
        new Popup({ maxWidth: '280px' }).setLngLat(e.lngLat).setDOMContent(content).addTo(map);
      });
    })().catch((e: unknown) => setFatal(`地図を開けませんでした: ${String(e)}`));
    return () => {
      disposed = true;
      mapRef.current?.remove();
      mapRef.current = null;
    };
    // toggleCode is stable (useCallback with no deps); the map must be created only once.
  }, [toggleCode]);

  // The map click handler is registered once, so it reads the attached set through a ref.
  useEffect(() => {
    attachedRef.current = attached;
  }, [attached]);

  // --- data index + stored files ------------------------------------------
  useEffect(() => {
    (async () => {
      const index = await fetchPrefIndex();
      setPrefs(index.prefs);
      const flags = await Promise.all(index.prefs.map((p) => isPrefStored(p)));
      setStored(new Set(index.prefs.filter((_, i) => flags[i]).map((p) => p.key)));
      setMemos(await dbAll<Memo>(STORES.memos));
      if (!flags.some(Boolean)) setTab('save');
    })().catch((e: unknown) =>
      setNotice(`データ一覧を読み込めませんでした（${String(e)}）。一度オンラインで開いてください`),
    );
  }, []);

  // --- attach stored prefecture layers ------------------------------------
  useEffect(() => {
    const map = mapRef.current;
    if (!mapReady || !map) return;
    const toAttach = storedPrefs.filter((p) => !attached.has(p.key));
    const toDetach = [...attached].filter((k) => !stored.has(k));
    if (toAttach.length === 0 && toDetach.length === 0) return;
    (async () => {
      for (const key of toDetach) removePrefLayers(map, key);
      for (const p of toAttach) addPrefLayers(map, p.key, await attachPref(p));
      setAttached(new Set(storedPrefs.map((p) => p.key)));
    })().catch((e: unknown) => setNotice(`植生データを開けませんでした: ${String(e)}`));
  }, [mapReady, storedPrefs, stored, attached]);

  // --- restyle on selection / elevation / kokuyu changes -------------------
  useEffect(() => {
    const map = mapRef.current;
    if (!mapReady || !map) return;
    for (const key of attached) {
      applyVegStyle(map, key, entries, elev, [...attached]);
      applyKokuyuVisibility(map, key, showKokuyu);
    }
  }, [mapReady, attached, entries, elev, showKokuyu]);

  // Terrain mask/highlight does not depend on any prefecture being stored.
  useEffect(() => {
    const map = mapRef.current;
    if (mapReady && map) applyElevationBand(map, terrainBand);
  }, [mapReady, terrainBand]);

  // --- memo markers --------------------------------------------------------
  useEffect(() => {
    const map = mapRef.current;
    if (!mapReady || !map) return;
    const markers = liveMemos.map((m) => {
      const popup = new Popup({ offset: 24 }).setText(
        `${new Date(m.time).toLocaleString('ja-JP')}\n${m.text}`,
      );
      return new Marker({ color: '#c0392b' }).setLngLat([m.lon, m.lat]).setPopup(popup).addTo(map);
    });
    return () => markers.forEach((mk) => mk.remove());
  }, [mapReady, liveMemos]);

  const onStorePref = async (p: PrefEntry) => {
    setBusyPref({ key: p.key, received: 0, total: p.vegBytes + p.kokuyuBytes });
    try {
      await navigator.storage?.persist?.();
      await storePref(p, (received, total) => setBusyPref({ key: p.key, received, total }));
      setStored((cur) => new Set(cur).add(p.key));
    } catch (e) {
      setNotice(`${p.name} を保存できませんでした: ${String(e)}`);
    } finally {
      setBusyPref(null);
    }
  };

  const onRemovePref = async (p: PrefEntry) => {
    if (!confirm(`${p.name} の植生データを端末から削除しますか？`)) return;
    await removePref(p);
    setStored((cur) => {
      const next = new Set(cur);
      next.delete(p.key);
      return next;
    });
  };

  const addMemos = async (added: Memo[]) => {
    const now = Date.now();
    const stamped = added.map((m) => ({ ...m, updatedAt: m.updatedAt ?? now }));
    for (const m of stamped) await dbPut(STORES.memos, m.id, m);
    setMemos((cur) => B.mergeMemos(cur, stamped));
  };
  // A deleted memo stays as a hidden tombstone so other devices' older copies cannot bring it back.
  const deleteMemo = async (id: string) => {
    const target = memos.find((m) => m.id === id);
    if (!target) return;
    const tomb = { ...target, deleted: true, updatedAt: Date.now() };
    await dbPut(STORES.memos, id, tomb);
    setMemos((cur) => cur.map((m) => (m.id === id ? tomb : m)));
  };

  const exportBackup = async (): Promise<string> => {
    const backup = B.buildBackup(memos, sel, { elev, kokuyu: showKokuyu, seasonOnly }, new Date());
    const name = `veg-map-backup-${new Date().toISOString().slice(0, 10)}.json`;
    const result = await exportFile(name, JSON.stringify(backup, null, 1), 'application/json');
    return result === 'cancelled' ? '' : `${name} を書き出しました`;
  };
  // Import merges (newer copy wins) instead of replacing, so backups from several devices combine.
  const importBackup = async (file: File): Promise<string> => {
    const backup = B.parseBackup(await file.text());
    const merged = B.mergeMemos(memos, backup.memos);
    for (const m of merged) await dbPut(STORES.memos, m.id, m);
    setMemos(merged);
    setSel((cur) => B.mergeSelection(cur, backup.groups, backup.tombstones, backup.individuals));
    const live = backup.memos.filter((m) => !m.deleted).length;
    return `読み込みました（メモ ${live} 件・グループ ${backup.groups.length} 件を統合）`;
  };
  const mapCenter = () => {
    const c = mapRef.current?.getCenter();
    return { lat: c?.lat ?? DEFAULT_VIEW.center[1], lon: c?.lng ?? DEFAULT_VIEW.center[0] };
  };
  const jumpTo = (m: Memo) => {
    mapRef.current?.flyTo({ center: [m.lon, m.lat], zoom: Math.max(15, mapRef.current.getZoom()) });
    setTab(null);
  };

  return (
    <div className="app">
      {/* Map and panel are stacked, so the panel never covers map controls or the crosshair. */}
      <div className="map-wrap">
        <div ref={containerRef} className="map" />
        {tab === 'memo' && <div className="crosshair">＋</div>}
        {!online && <div className="badge offline">オフライン</div>}
        {sel.selected.length + sel.groups.length > 0 && tab === null && (
          <div className="legend">
            {/* Groups collapse to one row each; individual legends follow. */}
            {sel.groups.map((g) => {
              const offSeason = seasonOnly && !G.inSeason(g, month);
              const cond = G.conditionText(g);
              return (
                <label key={g.id} className={G.groupOff(g, view) ? 'is-hidden' : ''}>
                  <input
                    type="checkbox"
                    checked={!g.hidden}
                    onChange={(e) => updateSel((cur) => G.updateGroup(cur, g.id, { hidden: !e.target.checked }))}
                  />
                  <span className="swatch" style={{ background: g.color }} />
                  <span>
                    {focus === g.id ? '🎯' : ''}
                    {g.name}（{G.membersOf(sel, g.id).length}）
                    {cond && <span className="legend-cond">{cond}</span>}
                    {offSeason && <span className="legend-cond">時期外</span>}
                  </span>
                </label>
              );
            })}
            {G.individuals(sel).map((s) => (
              <label key={s.code} className={s.hidden ? 'is-hidden' : ''}>
                <input
                  type="checkbox"
                  checked={!s.hidden}
                  onChange={(e) => updateSel((cur) => G.setHidden(cur, s.code, undefined, !e.target.checked))}
                />
                <span className="swatch" style={{ background: s.color }} />
                {legends.find((l) => l.c === s.code)?.n ?? s.code}
              </label>
            ))}
            {hasOverlap && (
              <div className="legend-overlap">
                <span className="swatch stripes" />
                重なり（複数グループに当てはまる）
              </div>
            )}
            {terrainBand.enabled && (
              <div className="legend-elev">
                {focusGroup?.elev ? `🎯${focusGroup.name} ` : ''}
                標高 {terrainBand.min}–{terrainBand.max}m
              </div>
            )}
          </div>
        )}
        {(fatal || notice) && (
          <div className="notice" onClick={() => setNotice(null)}>
            {fatal ?? notice}
          </div>
        )}
      </div>
      <div className={`sheet ${tab ? 'open' : ''} size-${sheetSize}`}>
        <nav className="tabs">
          {TABS.map(([t, label]) => (
            <button key={t} className={tab === t ? 'active' : ''} onClick={() => setTab(tab === t ? null : t)}>
              {label}
              {t === 'veg' && sel.selected.length > 0 ? `(${sel.selected.length})` : ''}
            </button>
          ))}
          {tab && (
            <button
              className="sheet-size"
              title="パネルの高さを切り替え（小→中→大）"
              onClick={() =>
                setSheetSize((cur) => SHEET_SIZES[(SHEET_SIZES.indexOf(cur) + 1) % SHEET_SIZES.length])
              }
            >
              ↕{SHEET_LABEL[sheetSize]}
            </button>
          )}
        </nav>
        {tab === 'veg' && (
          <SearchPanel
            legends={legends}
            sel={sel}
            onChange={updateSel}
            focus={focus}
            onFocus={setFocus}
            seasonOnly={seasonOnly}
            onSeasonOnly={setSeasonOnly}
            month={month}
          />
        )}
        {tab === 'elev' && (
          <ElevationPanel
            elev={elev}
            onChange={setElev}
            showKokuyu={showKokuyu}
            onShowKokuyu={setShowKokuyu}
            focus={focusGroup?.elev ? { name: focusGroup.name, band: focusGroup.elev } : null}
            onClearFocus={() => setFocus(null)}
          />
        )}
        {tab === 'save' && (
          <SavePanel
            prefs={prefs}
            stored={stored}
            busyPref={busyPref}
            onStorePref={(p) => void onStorePref(p)}
            onRemovePref={(p) => void onRemovePref(p)}
            viewBbox={viewBbox}
            onExportBackup={exportBackup}
            onImportBackup={importBackup}
          />
        )}
        {tab === 'memo' && (
          <MemoPanel
            memos={liveMemos}
            mapCenter={mapCenter}
            onAdd={(m) => void addMemos(m)}
            onDelete={(id) => void deleteMemo(id)}
            onJump={jumpTo}
          />
        )}
      </div>
    </div>
  );
}
