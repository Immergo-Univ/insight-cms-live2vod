"""
Extract single frames from HLS media playlists using ffmpeg.
Requires ffmpeg installed on PATH.
"""

from __future__ import annotations

import subprocess
import tempfile
from pathlib import Path

import cv2
import numpy as np


def ffprobe_duration_seconds(url: str, timeout: float = 120.0) -> float | None:
    cmd = [
        "ffprobe",
        "-v",
        "error",
        "-show_entries",
        "format=duration",
        "-of",
        "default=noprint_wrappers=1:nokey=1",
        url,
    ]
    try:
        out = subprocess.run(
            cmd,
            capture_output=True,
            text=True,
            timeout=timeout,
            check=False,
            stdin=subprocess.DEVNULL,
        )
    except FileNotFoundError:
        raise RuntimeError("ffprobe not found. Install ffmpeg.") from None

    text = (out.stdout or "").strip()
    if not text or text.lower() == "n/a":
        return None
    try:
        return float(text)
    except ValueError:
        return None


def extract_frame_bgr_at_offset(
    media_playlist_url: str,
    offset_seconds: float,
    timeout: float = 180.0,
) -> np.ndarray | None:
    """
    Decode one frame at approximately `offset_seconds` from the start of the VOD playlist.
    Uses ffmpeg; returns BGR uint8 image or None on failure.
    """
    with tempfile.NamedTemporaryFile(suffix=".png", delete=False) as tmp:
        out_path = Path(tmp.name)

    try:
        cmd = [
            "ffmpeg",
            "-nostdin",
            "-hide_banner",
            "-loglevel",
            "error",
            "-ss",
            str(max(0.0, offset_seconds)),
            "-i",
            media_playlist_url,
            "-frames:v",
            "1",
            "-q:v",
            "3",
            "-y",
            str(out_path),
        ]
        try:
            subprocess.run(
                cmd,
                capture_output=True,
                text=True,
                timeout=timeout,
                check=True,
                stdin=subprocess.DEVNULL,
            )
        except FileNotFoundError:
            raise RuntimeError("ffmpeg not found. Install ffmpeg.") from None
        except subprocess.CalledProcessError:
            return None

        if not out_path.is_file() or out_path.stat().st_size == 0:
            return None

        img = cv2.imread(str(out_path), cv2.IMREAD_COLOR)
        return img
    finally:
        try:
            out_path.unlink(missing_ok=True)
        except OSError:
            pass
