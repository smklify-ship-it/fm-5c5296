"""Web Mercator tile math and GSI elevation PNG decoding.

Pure functions only, so they can be unit tested without network or GIS libraries.
"""

from __future__ import annotations

import math

import numpy as np
import numpy.typing as npt

TILE_SIZE = 256
# Web Mercator cannot represent the poles; clamp like every slippy-map implementation.
MAX_LAT = 85.05112878

# GSI elevation PNG spec: https://maps.gsi.go.jp/development/demtile.html
DEM_UNIT_M = 0.01
DEM_NODATA = 2**23
DEM_WRAP = 2**24

BBox = tuple[float, float, float, float]  # (west, south, east, north) in degrees


def lonlat_to_pixel(lon: float, lat: float, zoom: int) -> tuple[float, float]:
    """Global pixel coordinate at `zoom` (origin = top-left of tile 0/0/0)."""
    lat = max(-MAX_LAT, min(MAX_LAT, lat))
    world = TILE_SIZE * 2**zoom
    x = (lon + 180.0) / 360.0 * world
    rad = math.radians(lat)
    y = (1.0 - math.log(math.tan(rad) + 1.0 / math.cos(rad)) / math.pi) / 2.0 * world
    return x, y


def lonlat_to_pixel_array(
    lon: npt.NDArray[np.float64], lat: npt.NDArray[np.float64], zoom: int
) -> tuple[npt.NDArray[np.float64], npt.NDArray[np.float64]]:
    """Vectorised `lonlat_to_pixel` for geometry transforms."""
    lat = np.clip(lat, -MAX_LAT, MAX_LAT)
    world = TILE_SIZE * 2**zoom
    x = (lon + 180.0) / 360.0 * world
    rad = np.radians(lat)
    y = (1.0 - np.log(np.tan(rad) + 1.0 / np.cos(rad)) / np.pi) / 2.0 * world
    return x, y


def lonlat_to_tile(lon: float, lat: float, zoom: int) -> tuple[int, int]:
    x, y = lonlat_to_pixel(lon, lat, zoom)
    last = 2**zoom - 1
    return min(last, int(x // TILE_SIZE)), min(last, int(y // TILE_SIZE))


def tiles_in_bbox(bbox: BBox, zmin: int, zmax: int) -> list[tuple[int, int, int]]:
    """All (z, x, y) tiles that intersect `bbox` for each zoom in [zmin, zmax]."""
    west, south, east, north = bbox
    if west > east or south > north:
        raise ValueError(f"invalid bbox (west,south,east,north): {bbox}")
    result: list[tuple[int, int, int]] = []
    for z in range(zmin, zmax + 1):
        x0, y0 = lonlat_to_tile(west, north, z)
        x1, y1 = lonlat_to_tile(east, south, z)
        for x in range(x0, x1 + 1):
            for y in range(y0, y1 + 1):
                result.append((z, x, y))
    return result


def decode_dem_png(rgb: npt.NDArray[np.uint8]) -> npt.NDArray[np.float32]:
    """Decode a GSI dem_png RGB array (H, W, 3) to metres; no-data becomes NaN."""
    r = rgb[..., 0].astype(np.int64)
    g = rgb[..., 1].astype(np.int64)
    b = rgb[..., 2].astype(np.int64)
    x = (r << 16) + (g << 8) + b
    # Values above 2^23 are negative heights stored as two's complement in 24 bits.
    signed = np.where(x > DEM_NODATA, x - DEM_WRAP, x)
    height = (signed * DEM_UNIT_M).astype(np.float32)
    height[x == DEM_NODATA] = np.nan
    return height
