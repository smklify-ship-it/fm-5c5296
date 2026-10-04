import numpy as np
import shapely

from vegmap.dem import DEM_ZOOM, DemMosaic, polygon_elevation
from vegmap.tiles import TILE_SIZE, lonlat_to_tile

LON, LAT = 139.0, 36.5


def _mosaic_with_gradient() -> DemMosaic:
    """One DEM tile around (LON, LAT) whose height = 1000 + column index (metres)."""
    tx, ty = lonlat_to_tile(LON, LAT, DEM_ZOOM)
    cols = np.arange(TILE_SIZE, dtype=np.float32)
    heights = np.tile(1000 + cols, (TILE_SIZE, 1))
    return DemMosaic(heights, tx * TILE_SIZE, ty * TILE_SIZE)


def _small_box() -> shapely.Geometry:
    d = 0.001  # ~90 m: a few DEM pixels wide
    return shapely.box(LON - d, LAT - d, LON + d, LAT + d)


def test_polygon_elevation_min_is_below_max_for_sloped_polygon() -> None:
    stats = polygon_elevation(_small_box(), _mosaic_with_gradient())
    assert stats is not None and stats[0] < stats[1]


def test_polygon_elevation_mean_lies_between_min_and_max() -> None:
    stats = polygon_elevation(_small_box(), _mosaic_with_gradient())
    assert stats is not None and stats[0] <= stats[2] <= stats[1]


def test_polygon_elevation_sliver_still_gets_value_from_vertices() -> None:
    sliver = shapely.box(LON, LAT, LON + 0.00001, LAT + 0.00001)
    assert polygon_elevation(sliver, _mosaic_with_gradient()) is not None


def test_polygon_elevation_all_nodata_returns_none() -> None:
    mosaic = _mosaic_with_gradient()
    empty = DemMosaic(np.full_like(mosaic.heights, np.nan), mosaic.origin_x, mosaic.origin_y)
    assert polygon_elevation(_small_box(), empty) is None


def test_polygon_elevation_outside_mosaic_returns_none() -> None:
    far = shapely.box(140.0, 35.0, 140.001, 35.001)
    assert polygon_elevation(far, _mosaic_with_gradient()) is None
