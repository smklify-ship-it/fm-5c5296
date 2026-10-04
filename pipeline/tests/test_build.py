import geopandas as gpd
import pandas as pd
import pytest
import shapely

from vegmap.build import select_veg_columns, summarize_legends


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
