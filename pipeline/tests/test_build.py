import geopandas as gpd
import pandas as pd
import pytest
import shapely

from vegmap.build import (
    SRC_FID,
    UNKNOWN_OWNER,
    assign_owners,
    merge_extracts,
    select_veg_columns,
    summarize_legends,
)


def _raw() -> gpd.GeoDataFrame:
    return gpd.GeoDataFrame(
        {
            "凡例コード": ["410101", "410101", "540100"],
            "凡例名": ["クリ－コナラ群集", "クリ－コナラ群集", "スギ・ヒノキ・サワラ植林"],
            "植生区分": [
                "ヤブツバキクラス域代償植生",
                "ヤブツバキクラス域代償植生",
                "植林地・耕作地植生",
            ],
            "作成年度": ["2011", "2011", "2000"],
        },
        geometry=[shapely.box(0, 0, 1, 1)] * 3,
        crs="EPSG:6668",
    )


def test_select_veg_columns_renames_to_short_keys() -> None:
    assert list(select_veg_columns(_raw()).columns) == ["c", "n", "k", "geometry"]


def test_select_veg_columns_converts_code_to_int() -> None:
    assert select_veg_columns(_raw())["c"].tolist() == [410101, 410101, 540100]


def test_select_veg_columns_missing_column_raises() -> None:
    with pytest.raises(KeyError):
        select_veg_columns(_raw().drop(columns=["凡例名"]))


def _with_elev() -> pd.DataFrame:
    df = pd.DataFrame(select_veg_columns(_raw()).drop(columns="geometry"))
    df["lo"] = pd.array([800, 1200, None], dtype="Int32")
    df["hi"] = pd.array([1000, 1500, None], dtype="Int32")
    return df


def test_summarize_legends_counts_polygons_per_legend() -> None:
    legends = summarize_legends(_with_elev())
    assert [(x["c"], x["count"]) for x in legends] == [(410101, 2), (540100, 1)]


def test_summarize_legends_elevation_range_spans_all_polygons() -> None:
    first = summarize_legends(_with_elev())[0]
    assert (first["lo"], first["hi"]) == (800, 1500)


def test_summarize_legends_missing_elevation_is_none() -> None:
    last = summarize_legends(_with_elev())[1]
    assert (last["lo"], last["hi"]) == (None, None)


def _grid() -> gpd.GeoDataFrame:
    # Three unit squares along x: [0,1], [1,2] (straddles the border at x=1.6), [3,4].
    # The border avoids x=1.5, the square's own centre: a point exactly on a border line
    # belongs to neither side, which real (irregular) boundaries practically never hit.
    return gpd.GeoDataFrame(
        {"c": [1, 2, 3]},
        geometry=[shapely.box(0, 0, 1, 1), shapely.box(1, 0, 2, 1), shapely.box(3, 0, 4, 1)],
        crs="EPSG:6668",
    )


WEST = shapely.box(-1, -1, 1.6, 2)
EAST = shapely.box(1.6, -1, 5, 2)


def test_assign_owners_drops_polygons_not_touching_the_prefecture() -> None:
    assert assign_owners(_grid(), WEST, "w", {})["c"].tolist() == [1, 2]


def test_assign_owners_border_polygon_is_in_both_prefecture_files() -> None:
    west = assign_owners(_grid(), WEST, "w", {"e": EAST})["c"].tolist()
    east = assign_owners(_grid(), EAST, "e", {"w": WEST})["c"].tolist()
    assert 2 in west and 2 in east


def test_assign_owners_owner_is_the_prefecture_holding_the_centre() -> None:
    east = assign_owners(_grid(), EAST, "e", {"w": WEST})
    assert east.set_index("c").loc[2, "o"] == "w"


def test_assign_owners_border_polygon_has_the_same_owner_in_both_files() -> None:
    west = assign_owners(_grid(), WEST, "w", {"e": EAST}).set_index("c")
    east = assign_owners(_grid(), EAST, "e", {"w": WEST}).set_index("c")
    assert west.loc[2, "o"] == east.loc[2, "o"]


def test_assign_owners_unknown_when_centre_is_in_an_unbuilt_prefecture() -> None:
    east = assign_owners(_grid(), EAST, "e", {})
    assert east.set_index("c").loc[2, "o"] == UNKNOWN_OWNER


def test_assign_owners_keeps_border_polygon_whole() -> None:
    east = assign_owners(_grid(), EAST, "e", {"w": WEST}).set_index("c")
    assert east.loc[2, "geometry"].equals(shapely.box(1, 0, 2, 1))


def _extract(fids: list[int]) -> gpd.GeoDataFrame:
    return gpd.GeoDataFrame(
        {SRC_FID: fids, "凡例コード": ["410101"] * len(fids)},
        geometry=[shapely.box(i, 0, i + 1, 1) for i in range(len(fids))],
        crs="EPSG:6668",
    )


def test_merge_extracts_keeps_one_copy_of_a_polygon_in_two_blocks() -> None:
    merged = merge_extracts([_extract([1, 2]), _extract([2, 3])])
    assert sorted(merged[SRC_FID].tolist()) == [1, 2, 3]


def test_merge_extracts_skips_empty_blocks() -> None:
    assert len(merge_extracts([_extract([]), _extract([7])])) == 1


def test_merge_extracts_with_nothing_found_raises() -> None:
    with pytest.raises(ValueError):
        merge_extracts([_extract([])])
