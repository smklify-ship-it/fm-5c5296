"""Build PMTiles + index JSON for one prefecture.

Usage:  uv run python -m vegmap.build gunma
Output: ../web/public/data/<key>.pmtiles, <key>_kokuyu.pmtiles, prefs.json
"""

from __future__ import annotations

import argparse
import json
import sys
import time
import zipfile
from datetime import date
from pathlib import Path
from typing import Any

import geopandas as gpd
import numpy as np
import pandas as pd
import pyogrio
import shapely

from .dem import DemMosaic, build_mosaic, polygon_elevation
from .fetch import download_file
from .tiles import BBox

ROOT = Path(__file__).resolve().parent.parent
CACHE = ROOT / "cache"
CONFIG = ROOT / "prefs_config.json"
OUT_DIR = ROOT.parent / "web" / "public" / "data"
INDEX_NAME = "prefs.json"

KOKUYU_URL = "https://nlftp.mlit.go.jp/ksj/gml/data/A45/A45-19/A45-19_{code}_GML.zip"
# 国土数値情報 行政区域 (2025-01-01). Used to give every polygon to exactly one prefecture.
BOUNDARY_URL = "https://nlftp.mlit.go.jp/ksj/gml/data/N03/N03-2025/N03-20250101_{code}_GML.zip"

# Below z8 a prefecture is a few hundred pixels wide; vegetation is unreadable there and
# would only bloat the file. MapLibre over-zooms z13 tiles for closer views: at 36N a z13
# tile is ~4 km wide, so its 4096-unit grid still resolves ~1 m.
MIN_ZOOM = 8
MAX_ZOOM = 13
# Douglas-Peucker tolerance in tile units (4 units ≈ 4 m at z13). The 1/25,000 source is
# only accurate to ~12 m; measured on Gunma this cut the file from 64 MB to 38 MB.
SIMPLIFICATION = 4
# GDAL's default 500 KB tile cap silently degraded dense low-zoom tiles (Mt. Akagi vanished at
# z9). 1 MB removes every over-size warning for Gunma at +2 MB total file size.
MAX_TILE_BYTES = 1_000_000
WEB_MERCATOR = "EPSG:3857"

# Short attribute keys keep every tile small; the app maps them back to labels.
VEG_COLUMNS = {"凡例コード": "c", "凡例名": "n", "植生区分": "k"}
KOKUYU_COLUMNS = {"A45_013": "name", "A45_011": "han", "A45_015": "sp"}


def load_config() -> dict[str, Any]:
    with CONFIG.open(encoding="utf-8-sig") as f:
        config: dict[str, Any] = json.load(f)
    return config


def select_veg_columns(df: gpd.GeoDataFrame) -> gpd.GeoDataFrame:
    """Keep only the attributes the app uses, under short keys; code becomes int."""
    missing = [c for c in VEG_COLUMNS if c not in df.columns]
    if missing:
        raise KeyError(f"vegetation data lacks expected columns: {missing}")
    out = df[[*VEG_COLUMNS, "geometry"]].rename(columns=VEG_COLUMNS)
    out["c"] = pd.to_numeric(out["c"], errors="raise").astype("int64")
    return gpd.GeoDataFrame(out, geometry="geometry", crs=df.crs)


def add_elevation(df: gpd.GeoDataFrame, mosaic: DemMosaic) -> gpd.GeoDataFrame:
    lo: list[float] = []
    hi: list[float] = []
    av: list[float] = []
    started = time.monotonic()
    total = len(df)
    for i, geom in enumerate(df.geometry, start=1):
        stats = polygon_elevation(geom, mosaic)
        if stats is None:
            lo.append(np.nan)
            hi.append(np.nan)
            av.append(np.nan)
        else:
            lo.append(stats[0])
            hi.append(stats[1])
            av.append(stats[2])
        if i % 5000 == 0 or i == total:
            print(
                f"\r  elevation {i}/{total} ({time.monotonic() - started:.0f}s)", end="", flush=True
            )
    print()
    out = df.copy()
    # Nullable ints: polygons over no-data (sea, missing DEM) keep a null, not a fake 0.
    out["lo"] = pd.array(lo, dtype="Int32")
    out["hi"] = pd.array(hi, dtype="Int32")
    out["av"] = pd.array(av, dtype="Int32")
    return out


def summarize_legends(df: pd.DataFrame) -> list[dict[str, Any]]:
    """One entry per legend: code, name, category, polygon count, elevation range."""
    grouped = df.groupby(["c", "n", "k"], sort=False).agg(
        count=("c", "size"), lo=("lo", "min"), hi=("hi", "max")
    )
    grouped = grouped.reset_index().sort_values(["count", "c"], ascending=[False, True])
    legends: list[dict[str, Any]] = []
    for row in grouped.itertuples(index=False):
        legends.append(
            {
                "c": int(row.c),
                "n": str(row.n),
                "k": str(row.k),
                "count": int(row.count),
                "lo": None if pd.isna(row.lo) else int(row.lo),
                "hi": None if pd.isna(row.hi) else int(row.hi),
            }
        )
    return legends


UNKNOWN_OWNER = "-"


def assign_owners(
    df: gpd.GeoDataFrame,
    boundary: shapely.Geometry,
    key: str,
    others: dict[str, shapely.Geometry],
) -> gpd.GeoDataFrame:
    """Every polygon touching the prefecture, kept whole, with its owner in column "o".

    Owner = the prefecture containing the polygon's representative point: `key`, one of the
    other configured prefectures, or UNKNOWN_OWNER. The file alone covers the prefecture up
    to (and across) its border; the app hides a borrowed polygon when its owner's file is
    also on the device, so stored neighbours never double-paint.
    """
    shapely.prepare(boundary)
    touching = df[shapely.intersects(boundary, df.geometry.to_numpy())].reset_index(drop=True)
    points = touching.geometry.representative_point()
    xs, ys = points.x.to_numpy(), points.y.to_numpy()
    owner = np.where(shapely.contains_xy(boundary, xs, ys), key, UNKNOWN_OWNER).astype(object)
    for other_key, other in others.items():
        undecided = owner == UNKNOWN_OWNER
        if not undecided.any():
            break
        shapely.prepare(other)
        hit = shapely.contains_xy(other, xs[undecided], ys[undecided])
        owner[np.flatnonzero(undecided)[hit]] = other_key
    out = touching.copy()
    out["o"] = owner.astype(str)
    return out


def _read_shp_from_zip(zip_path: Path) -> gpd.GeoDataFrame:
    with zipfile.ZipFile(zip_path) as zf:
        shp = next((n for n in zf.namelist() if n.lower().endswith(".shp")), None)
    if shp is None:
        raise FileNotFoundError(f"no .shp inside {zip_path}")
    # The zips ship a .cpg (Shift_JIS); GDAL honours it, so no encoding override here.
    return pyogrio.read_dataframe(f"/vsizip/{zip_path.as_posix()}/{shp}")


def read_pref_boundary(code: str, crs: Any) -> shapely.Geometry:
    zip_path = download_file(
        BOUNDARY_URL.format(code=code), CACHE / "boundary" / f"N03-20250101_{code}_GML.zip"
    )
    df = _read_shp_from_zip(zip_path).to_crs(crs)
    return shapely.union_all(shapely.make_valid(df.geometry.to_numpy()))


def write_pmtiles(df: gpd.GeoDataFrame, path: Path, layer: str, description: str) -> None:
    if path.exists():
        path.unlink()
    df.to_crs(WEB_MERCATOR).to_file(
        path,
        driver="PMTiles",
        engine="pyogrio",
        layer=layer,
        # Without this, Windows (cp932 locale) writes Japanese attributes as Shift_JIS bytes.
        encoding="UTF-8",
        dataset_options={
            "MINZOOM": str(MIN_ZOOM),
            "MAXZOOM": str(MAX_ZOOM),
            "SIMPLIFICATION": str(SIMPLIFICATION),
            "MAX_SIZE": str(MAX_TILE_BYTES),
            "NAME": layer,
            "DESCRIPTION": description,
        },
    )


def read_kokuyu(code: str) -> gpd.GeoDataFrame:
    zip_path = download_file(
        KOKUYU_URL.format(code=code), CACHE / "kokuyu" / f"A45-19_{code}_GML.zip"
    )
    df = _read_shp_from_zip(zip_path)
    out = df[[*KOKUYU_COLUMNS, "geometry"]].rename(columns=KOKUYU_COLUMNS)
    return gpd.GeoDataFrame(out, geometry="geometry", crs=df.crs)


def update_index(entry: dict[str, Any]) -> Path:
    index_path = OUT_DIR / INDEX_NAME
    prefs: list[dict[str, Any]] = []
    if index_path.exists():
        with index_path.open(encoding="utf-8") as f:
            prefs = json.load(f)["prefs"]
    prefs = [p for p in prefs if p["key"] != entry["key"]] + [entry]
    prefs.sort(key=lambda p: str(p["key"]))
    with index_path.open("w", encoding="utf-8", newline="\n") as f:
        json.dump({"version": 1, "prefs": prefs}, f, ensure_ascii=False, separators=(",", ":"))
    return index_path


# Every veg2024 block GPKG is JGD2011 geographic.
VEG_CRS = "EPSG:6668"
EXTRACT_DIR = CACHE / "extract"
# Column keeping the national feature id; GPKG rewrites its own FID on write.
SRC_FID = "src_fid"


def _extract_path(key: str, block: str) -> Path:
    return EXTRACT_DIR / key / f"{block}.gpkg"


def _extract_marker(key: str, block: str) -> Path:
    # Written even when the block holds nothing for this prefecture, so it is not re-read.
    return EXTRACT_DIR / key / f"{block}.done"


def merge_extracts(frames: list[gpd.GeoDataFrame]) -> gpd.GeoDataFrame:
    """Concatenate per-block extracts, keeping one copy of a polygon present in two blocks.

    The vegetation map is split into blocks by map sheet, not by prefecture, so a
    prefecture's border area can sit in a neighbouring block (seen: Nagano's side of
    Torii-toge is only in the Kanto block). feature ids are national, so they dedupe.
    """
    non_empty = [f for f in frames if len(f) > 0]
    if not non_empty:
        raise ValueError("no vegetation polygons found in any block for this prefecture")
    merged = gpd.GeoDataFrame(pd.concat(non_empty, ignore_index=True), crs=non_empty[0].crs)
    return merged.drop_duplicates(subset=SRC_FID).reset_index(drop=True)


def extract_block(block: str, keys: list[str], config: dict[str, Any]) -> None:
    """Download one block and save, per prefecture, the polygons touching it; then delete it.

    Only one ~1 GB block is on disk at a time (the dev PC has ~3 GB free).
    """
    gpkg = download_file(config["blocks"][block], CACHE / "blocks" / f"veg2024{block}.gpkg")
    try:
        for key in keys:
            boundary = read_pref_boundary(str(config["prefs"][key]["code"]), VEG_CRS)
            raw = pyogrio.read_dataframe(
                gpkg,
                bbox=tuple(shapely.bounds(boundary)),
                columns=list(VEG_COLUMNS),
                fid_as_index=True,
            )
            shapely.prepare(boundary)
            raw = raw[shapely.intersects(boundary, raw.geometry.to_numpy())]
            out = _extract_path(key, block)
            out.parent.mkdir(parents=True, exist_ok=True)
            if len(raw) > 0:
                frame = raw.reset_index(names=SRC_FID)
                frame.to_file(out, driver="GPKG", engine="pyogrio")
            _extract_marker(key, block).touch()
            print(f"  {block} -> {key}: {len(raw)} polygons", flush=True)
    finally:
        gpkg.unlink(missing_ok=True)
        print(f"deleted {gpkg.name}", flush=True)


def ensure_extracts(config: dict[str, Any]) -> None:
    """Extract every block for every configured prefecture that has not been extracted yet."""
    keys = list(config["prefs"])
    for block in config["blocks"]:
        missing = [k for k in keys if not _extract_marker(k, block).exists()]
        if missing:
            print(f"block {block}: extracting for {', '.join(missing)}", flush=True)
            extract_block(block, missing, config)


def load_extracts(key: str, config: dict[str, Any]) -> gpd.GeoDataFrame:
    frames = [
        pyogrio.read_dataframe(_extract_path(key, b))
        for b in config["blocks"]
        if _extract_path(key, b).exists()
    ]
    return merge_extracts(frames)


def build(key: str) -> Path:
    config = load_config()
    if key not in config["prefs"]:
        known = ", ".join(config["prefs"])
        raise SystemExit(f"unknown prefecture key '{key}'. Known: {known} (see prefs_config.json)")
    pref = config["prefs"][key]
    code = str(pref["code"])
    OUT_DIR.mkdir(parents=True, exist_ok=True)

    ensure_extracts(config)
    boundary = read_pref_boundary(code, VEG_CRS)
    others = {
        k: read_pref_boundary(str(v["code"]), VEG_CRS)
        for k, v in config["prefs"].items()
        if k != key
    }
    west, south, east, north = (float(v) for v in shapely.bounds(boundary))
    bbox: BBox = (west, south, east, north)
    raw = load_extracts(key, config)
    veg = assign_owners(select_veg_columns(raw), boundary, key, others)
    del raw
    borrowed = int((veg["o"] != key).sum())
    print(
        f"{pref['name']}: {len(veg)} polygons ({borrowed} across the border, kept whole)",
        flush=True,
    )

    # Border polygons reach outside the prefecture; widen the DEM to cover them entirely.
    dw, ds, de, dn = (float(v) for v in veg.total_bounds)
    mosaic = build_mosaic((dw, ds, de, dn), CACHE / "dem")
    veg = add_elevation(veg, mosaic)

    veg_path = OUT_DIR / f"{key}.pmtiles"
    print(f"writing {veg_path.name} ...", flush=True)
    write_pmtiles(veg, veg_path, "veg", "現存植生図2024(環境省生物多様性センター)を加工")

    kokuyu = read_kokuyu(code)
    kokuyu_path = OUT_DIR / f"{key}_kokuyu.pmtiles"
    print(f"writing {kokuyu_path.name} ({len(kokuyu)} polygons) ...", flush=True)
    write_pmtiles(kokuyu, kokuyu_path, "kokuyu", "国土数値情報(国有林野データ)を加工")

    entry = {
        "key": key,
        "name": pref["name"],
        "bbox": [round(v, 4) for v in bbox],
        "veg": veg_path.name,
        "vegBytes": veg_path.stat().st_size,
        "kokuyu": kokuyu_path.name,
        "kokuyuBytes": kokuyu_path.stat().st_size,
        "built": date.today().isoformat(),
        "legends": summarize_legends(veg),
    }
    index_path = update_index(entry)
    print(
        f"done: {veg_path.name} {entry['vegBytes'] / 1e6:.1f} MB, "
        f"{kokuyu_path.name} {entry['kokuyuBytes'] / 1e6:.1f} MB, index {index_path.name}"
    )
    return veg_path


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        description="Build vegetation PMTiles. 'all' builds every prefecture in prefs_config.json."
    )
    parser.add_argument("key", help="prefecture key in prefs_config.json (e.g. gunma) or 'all'")
    args = parser.parse_args(argv)
    keys = list(load_config()["prefs"]) if args.key == "all" else [args.key]
    for key in keys:
        build(key)
    return 0


if __name__ == "__main__":
    sys.exit(main())
