"""Small HTTP download helpers (stdlib only) with on-disk caching."""

from __future__ import annotations

import shutil
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path

USER_AGENT = "veg-map-pipeline/1.0 (personal mushroom-hunting map)"
RETRIES = 5
RETRY_WAIT_S = 3.0
CHUNK = 1024 * 1024


def _request(url: str) -> urllib.request.Request:
    return urllib.request.Request(url, headers={"User-Agent": USER_AGENT})


def download_file(url: str, dest: Path) -> Path:
    """Download `url` to `dest` once; later calls reuse the file."""
    if dest.exists():
        return dest
    dest.parent.mkdir(parents=True, exist_ok=True)
    part = dest.with_suffix(dest.suffix + ".part")
    print(f"downloading {dest.name} ...", flush=True)
    with urllib.request.urlopen(_request(url), timeout=60) as res, part.open("wb") as out:
        total = int(res.headers.get("Content-Length") or 0)
        done = 0
        while chunk := res.read(CHUNK):
            out.write(chunk)
            done += len(chunk)
            if total:
                print(f"\r  {done / total:6.1%} of {total / 1e6:.0f} MB", end="", flush=True)
    print()
    shutil.move(part, dest)
    return dest


def fetch_bytes_cached(url: str, cache_path: Path, interval_s: float) -> bytes | None:
    """GET `url` with a disk cache. Returns None on HTTP 404 (e.g. sea tiles).

    `interval_s` is slept after every real network request so bulk tile fetches stay
    gentle on the public GSI server.
    """
    missing_marker = cache_path.with_suffix(cache_path.suffix + ".404")
    if cache_path.exists():
        return cache_path.read_bytes()
    if missing_marker.exists():
        return None
    cache_path.parent.mkdir(parents=True, exist_ok=True)
    last_error: Exception | None = None
    for attempt in range(1, RETRIES + 1):
        try:
            with urllib.request.urlopen(_request(url), timeout=30) as res:
                data: bytes = res.read()
            cache_path.write_bytes(data)
            time.sleep(interval_s)
            return data
        except urllib.error.HTTPError as e:
            if e.code == 404:
                missing_marker.touch()
                time.sleep(interval_s)
                return None
            last_error = e
        except OSError as e:
            # URLError, timeouts and connection resets (WinError 10054 seen from the GSI server
            # mid-run) are all OSError; any of them is worth a retry.
            last_error = e
        print(f"  retry {attempt}/{RETRIES} for {url}: {last_error}", file=sys.stderr)
        time.sleep(RETRY_WAIT_S * attempt)
    raise RuntimeError(f"failed to fetch {url}") from last_error
