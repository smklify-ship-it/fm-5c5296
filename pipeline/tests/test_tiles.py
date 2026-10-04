import numpy as np
import pytest

from vegmap.tiles import decode_dem_png, lonlat_to_tile, tiles_in_bbox


def test_lonlat_to_tile_just_south_east_of_origin_is_tile_1_1_at_zoom_1() -> None:
    assert lonlat_to_tile(0.001, -0.001, 1) == (1, 1)


def test_lonlat_to_tile_east_edge_is_clamped_to_last_tile() -> None:
    assert lonlat_to_tile(180.0, 0.0, 3) == (7, 4)


def test_tiles_in_bbox_single_point_gives_one_tile_per_zoom() -> None:
    tiles = tiles_in_bbox((139.06, 36.39, 139.06, 36.39), 10, 12)
    assert [t[0] for t in tiles] == [10, 11, 12]


def test_tiles_in_bbox_count_is_product_of_spans() -> None:
    x0, y0 = lonlat_to_tile(138.9, 36.6, 12)
    x1, y1 = lonlat_to_tile(139.1, 36.4, 12)
    tiles = tiles_in_bbox((138.9, 36.4, 139.1, 36.6), 12, 12)
    assert len(tiles) == (x1 - x0 + 1) * (y1 - y0 + 1)


def test_tiles_in_bbox_rejects_inverted_bbox() -> None:
    with pytest.raises(ValueError):
        tiles_in_bbox((139.1, 36.4, 138.9, 36.6), 12, 12)


def _rgb(r: int, g: int, b: int) -> np.ndarray:
    return np.array([[[r, g, b]]], dtype=np.uint8)


def test_decode_dem_png_positive_height() -> None:
    # x = 1*65536 + 0*256 + 0 = 65536 -> 655.36 m
    assert decode_dem_png(_rgb(1, 0, 0))[0, 0] == pytest.approx(655.36)


def test_decode_dem_png_nodata_is_nan() -> None:
    assert np.isnan(decode_dem_png(_rgb(128, 0, 0))[0, 0])


def test_decode_dem_png_negative_height_wraps() -> None:
    # x = 2^24 - 100 -> -100 * 0.01 = -1.00 m
    assert decode_dem_png(_rgb(255, 255, 156))[0, 0] == pytest.approx(-1.0)
