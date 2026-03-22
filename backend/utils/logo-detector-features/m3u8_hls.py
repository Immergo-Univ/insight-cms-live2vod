"""
HLS helpers: resolve master playlists, parse media playlists, compute sample timestamps.
"""

from __future__ import annotations

import re
import urllib.parse
from dataclasses import dataclass
from pathlib import Path

import requests

DATE_TAG = "#EXT-X-PROGRAM-DATE-TIME:"
INF_TAG = "#EXTINF:"


@dataclass
class ParsedPlaylist:
    """Media playlist with accumulated segment end times (seconds from stream start)."""

    base_url: str
    segment_durations: list[float]
    segment_uris: list[str]
    program_datetimes_iso: list[str | None]


def _join_url(base: str, uri: str) -> str:
    if uri.startswith("http://") or uri.startswith("https://"):
        return uri
    if base.startswith("http://") or base.startswith("https://"):
        return urllib.parse.urljoin(base, uri)
    base_path = Path(base.rstrip("/"))
    return str((base_path / uri).resolve())


def _playlist_base_dir(m3u8_ref: str) -> str:
    p = Path(m3u8_ref)
    if p.is_file():
        return str(p.resolve().parent).rstrip("/") + "/"
    if "/" in m3u8_ref:
        return m3u8_ref.rsplit("/", 1)[0] + "/"
    return "./"


def fetch_text(url: str, timeout: float = 60.0) -> str:
    local = Path(url)
    if local.is_file():
        return local.read_text(encoding="utf-8", errors="replace")
    r = requests.get(url, timeout=timeout)
    r.raise_for_status()
    return r.text


def resolve_media_playlist_url(m3u8_url: str, timeout: float = 60.0) -> str:
    """
    If URL is a master playlist, pick the variant with highest BANDWIDTH.
    Otherwise return the same URL.
    """
    text = fetch_text(m3u8_url, timeout=timeout)
    lines = [ln.strip() for ln in text.splitlines() if ln.strip()]

    if not any(ln.startswith("#EXT-X-STREAM-INF") for ln in lines):
        return m3u8_url

    base = _playlist_base_dir(m3u8_url)
    best_bw = -1
    best_uri: str | None = None
    i = 0
    while i < len(lines):
        ln = lines[i]
        if ln.startswith("#EXT-X-STREAM-INF"):
            m = re.search(r"BANDWIDTH=(\d+)", ln)
            bw = int(m.group(1)) if m else 0
            if i + 1 < len(lines) and not lines[i + 1].startswith("#"):
                uri = lines[i + 1]
                if bw >= best_bw:
                    best_bw = bw
                    best_uri = uri
            i += 2
            continue
        i += 1

    if not best_uri:
        raise ValueError("Master playlist has no variant URI")

    return _join_url(base, best_uri)


def parse_media_playlist(m3u8_url: str, timeout: float = 60.0) -> ParsedPlaylist:
    text = fetch_text(m3u8_url, timeout=timeout)
    base = _playlist_base_dir(m3u8_url)

    durations: list[float] = []
    uris: list[str] = []
    dates: list[str | None] = []

    current_date: str | None = None
    for raw in text.splitlines():
        line = raw.strip()
        if not line:
            continue
        if line.startswith(DATE_TAG):
            current_date = line[len(DATE_TAG) :].strip()
            continue
        if line.startswith(INF_TAG):
            # #EXTINF:duration,
            rest = line[len(INF_TAG) :]
            dur_str = rest.split(",", 1)[0].strip()
            try:
                dur = float(dur_str)
            except ValueError:
                dur = 0.0
            durations.append(dur)
            dates.append(current_date)
            current_date = None
            continue
        if line.startswith("#"):
            continue
        if durations and len(uris) < len(durations):
            uris.append(_join_url(base, line))

    # Align lengths if playlist ended oddly
    while len(uris) < len(durations):
        uris.append("")
    while len(dates) < len(durations):
        dates.append(None)

    return ParsedPlaylist(
        base_url=base,
        segment_durations=durations,
        segment_uris=uris,
        program_datetimes_iso=dates,
    )


def total_duration_seconds(parsed: ParsedPlaylist) -> float:
    return float(sum(parsed.segment_durations))


def sample_timestamps_in_window(
    total_seconds: float,
    window_hours: float = 6.0,
    interval_minutes: float = 10.0,
    num_samples: int = 36,
) -> list[float]:
    """
    Return seek offsets (seconds from start of stream) for each sample in the last window.
    Evenly spaced every `interval_minutes` within [max(0, end - window), end).
    """
    window_sec = window_hours * 3600.0
    interval_sec = interval_minutes * 60.0
    end = max(0.0, total_seconds)
    start = max(0.0, end - window_sec)

    if end <= 0:
        return []

    # Target: num_samples points spaced by interval_sec inside [start, end]
    times: list[float] = []
    t = start
    while len(times) < num_samples and t <= end + 1e-6:
        times.append(min(t, end - 1e-3))  # stay slightly before EOF for ffmpeg
        t += interval_sec

    if not times:
        times = [min(end / 2, end - 1e-3)]

    return times[:num_samples]
