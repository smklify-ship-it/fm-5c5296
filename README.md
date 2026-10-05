# 植生マップ（veg-map）

きのこ狩り用。地理院の等高線地図の上に、環境省「現存植生図2024」（1/2.5万）を**群落名で検索・選択して色分け表示**する PWA。
PC と Android の同じアプリで使え、出発前に保存しておけば**圏外でも**地図・植生・現在地が見える。

## 使い方（スマホ・PC 共通）

1. **保存タブ → ① 県の植生データ「保存」**（初回だけ。数十MB）
2. **群落タブ** で名前を検索（ひらがな可・例「みずなら」「あかまつ」「ブナ ササ」）→ チェック、または「表示中をすべて選ぶ」
3. **標高・国有林タブ** で標高帯の絞り込み、国有林境界（茶色破線）の表示
4. 地図をタップ → その場所の群落名・植生区分・標高・国有林（林班・樹種）
5. **出発前**: 行く山を画面に収めて **保存タブ → ② 「この範囲を保存」**（背景の等高線地図＋地名フォント）
6. **メモタブ** で発見地点を記録 → GPX で書き出し／読み込み（PC⇔スマホの受け渡し、ジオグラフィカにも読める）

> 標高絞り込みは「区画の一部でもその標高帯にかかれば表示」。区画は分割しないので、標高差の大きい区画は帯の外まで色が付く。

## PC で開く

`start-map.bat` をダブルクリック → ブラウザで http://localhost:4173 が開く。

## 県を追加する／データを作り直す

1. `pipeline\prefs_config.json` の `prefs` に県を追記（`code` = 都道府県コード2桁、`block` = その県を含む植生図の地域ブロック）
2. `build-pref.bat <キー>`（例 `build-pref.bat nagano`）をダブルクリック or 実行
   - 初回は地域ブロックの植生 GPKG（0.5〜1GB）・県境・国有林・標高タイル（約1,000〜3,000枚）を自動ダウンロードする。2回目以降は `pipeline\cache\` を再利用（GPKG は消してもよい。次回また自動で取り直す）
   - 県境（行政区域）で切り出す。県境をまたぐ区画は中心がある県だけに入るので、隣県を両方保存しても重ならない
3. `web\public\data\` に `<キー>.pmtiles` `<キー>_kokuyu.pmtiles` `prefs.json` ができる

必要なもの: [uv](https://docs.astral.sh/uv/)（Python）、Node.js＋pnpm（アプリのビルド）。

## 構成

| パス | 役割 |
|---|---|
| `pipeline/vegmap/build.py` | 植生 GPKG → 県範囲で切出し → 属性を絞る → 標高(min/max/mean)付与 → PMTiles |
| `pipeline/vegmap/dem.py` | 地理院 標高タイル(dem_png z13)の取得・キャッシュ・区画ごとの標高集計 |
| `pipeline/vegmap/tiles.py` | タイル座標計算・標高PNGの復号（純関数） |
| `web/src/lib/basemap.ts` | 背景（地理院最適化ベクトルタイル）の取得と範囲保存（IndexedDB） |
| `web/src/lib/vegsource.ts` | 県 PMTiles を端末に丸ごと保存して読む |
| `web/src/lib/search.ts` | 群落名検索（かな・濁点・記号のゆれ吸収） |
| `web/src/lib/style.ts` | 選択群落・標高帯 → MapLibre のフィルタ／色 |

品質ゲート: `pipeline` で `uv run pytest` / `uv run mypy` / `uv run ruff check .`、`web` で `pnpm test` / `pnpm typecheck` / `pnpm lint` / `pnpm build`。

## 出典

- 植生: 「現存植生図2024」（環境省生物多様性センター）https://www.geospatial.jp/ckan/dataset/biodic_veg2024 を加工して作成（公共データ利用規約 第1.0版）
- 国有林: 「国土数値情報（国有林野データ）」（国土交通省）https://nlftp.mlit.go.jp/ksj/ をもとに作成（原典: 林野庁 国有林GIS、2018年4月1日時点、CC BY 4.0）
- 背景地図: 国土地理院最適化ベクトルタイル（試験公開）https://github.com/gsi-cyberjapan/optimal_bvmap
- 標高: 地理院タイル（標高タイル）https://maps.gsi.go.jp/development/ichiran.html を加工
- 県境: 「国土数値情報（行政区域データ）」（国土交通省）https://nlftp.mlit.go.jp/ksj/ をもとに作成（2025年1月1日時点）

国有林の入林・採取ルールは各森林管理署に確認すること。このアプリは植生の目安を示すだけで、キノコの発生や食毒を保証しない。
