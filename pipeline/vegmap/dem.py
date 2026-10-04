"""GSI elevation tiles -> in-memory mosaic -> per-polygon elevation stats."""

from __future__ import annotations

import io
from dataclasses import dataclass
from pathlib import Path

import numpy as np
import numpy.typing as npt
import shapely
from PIL import Image

from .fetch import fetch_bytes_cached
from .tiles import TILE_SIZE, BBox, decode_dem_png, lonlat_to_pixel_array, tiles_in_bbox

# dem_png (DEM10B) z13 is ~15 m/pixel at 36N: enough for 100 m elevation bands and
# needs 4x fewer requests than z14.
DEM_ZOOM = 13
DEM_URL = "https://cyberjapandata.gsi.go.jp/xyz/dem_png/{z}/{x}/{y}.png"
REQUEST_INTERVAL_S = 0.2


@dataclass(frozen=True)
class DemMosaic:
    heights: npt.NDArray[np.float32]  # (rows, cols) metres, NaN = no data
    origin_x: int  # global pixel x of column 0 at DEM_ZOOM
    origin_y: int  # global pixel y of row 0 at DEM_ZOOM


def build_mosaic(bbox: BBox, cache_dir: Path) -> DemMosaic:
    tiles = tiles_in_bbox(bbox, DEM_ZOOM, DEM_ZOOM)
    xs = [t[1] for t in tiles]
    ys = [t[2] for t in tiles]
    x0, y0 = min(xs), min(ys)
    cols = (max(xs) - x0 + 1) * TILE_SIZE
    rows = (max(ys) - y0 + 1) * TILE_SIZE
    heights = np.full((rows, cols), np.nan, dtype=np.float32)
    print(f"elevation tiles: {len(tiles)} (cached ones are skipped)", flush=True)
    for i, (z, x, y) in enumerate(tiles, start=1):
        url = DEM_URL.format(z=z, x=x, y=y)
        data = fetch_bytes_cached(url, cache_dir / str(z) / str(x) / f"{y}.png", REQUEST_INTERVAL_S)
        if i % 100 == 0 or i == len(tiles):
            print(f"\r  {i}/{len(tiles)}", end="", flush=True)
        if data is None:
            continue
        rgb = np.asarray(Image.open(io.BytesIO(data)).convert("RGB"))
        r = (y - y0) * TILE_SIZE
        c = (x - x0) * TILE_SIZE
        heights[r : r + TILE_SIZE, c : c + TILE_SIZE] = decode_dem_png(rgb)
    print()
    return DemMosaic(heights, x0 * TILE_SIZE, y0 * TILE_SIZE)


def _to_mosaic_pixels(geom: shapely.Geometry, mosaic: DemMosaic) -> shapely.Geometry:
    def transform(coords: npt.NDArray[np.float64]) -> npt.NDArray[np.float64]:
        px, py = lonlat_to_pixel_array(coords[:, 0], coords[:, 1], DEM_ZOOM)
        return np.column_stack([px - mosaic.origin_x, py - mosaic.origin_y])

    return shapely.transform(geom, transform)


def polygon_elevation(geom: shapely.Geometry, mosaic: DemMosaic) -> tuple[int, int, int] | None:
    """(min, max, mean) metres of DEM pixels inside `geom` (lon/lat), or None if no data.

    Pixel centres inside the polygon are sampled, plus every vertex, so slivers thinner
    than one pixel still get a value.
    """
    pix = _to_mosaic_pixels(geom, mosaic)
    rows, cols = mosaic.heights.shape
    minx, miny, maxx, maxy = pix.bounds
    c0, c1 = max(0, int(np.floor(minx))), min(cols - 1, int(np.floor(maxx)))
    r0, r1 = max(0, int(np.floor(miny))), min(rows - 1, int(np.floor(maxy)))
    if c0 > c1 or r0 > r1:
        return None
    gx, gy = np.meshgrid(np.arange(c0, c1 + 1), np.arange(r0, r1 + 1))
    shapely.prepare(pix)
    inside = shapely.contains_xy(pix, gx + 0.5, gy + 0.5)
    samples = [mosaic.heights[gy[inside], gx[inside]]]

    verts = shapely.get_coordinates(pix)
    vc = np.clip(np.floor(verts[:, 0]).astype(np.int64), 0, cols - 1)
    vr = np.clip(np.floor(verts[:, 1]).astype(np.int64), 0, rows - 1)
    samples.append(mosaic.heights[vr, vc])

    values = np.concatenate(samples)
    values = values[~np.isnan(values)]
    if values.size == 0:
        return None
    return int(round(values.min())), int(round(values.max())), int(round(values.mean()))
