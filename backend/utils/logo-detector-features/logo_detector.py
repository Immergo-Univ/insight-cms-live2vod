#!/usr/bin/env python3
"""
Logo detector from an HLS m3u8 URL:
  1) Pick the corner (cohesion + edge-on-stable structure).
  2) Fuse multiple bbox strategies inside that quadrant (variance, median consensus, stable edges).
  3) Save a full frame with the ROI drawn in red: output/logo<YYYYMMDDHHMMSS>.png

Requires system packages: ffmpeg, ffprobe (PATH).

Usage:
  ./run-logo-detector.sh <m3u8_url>
  # or: source .venv/bin/activate && python logo_detector.py <m3u8_url>

Output:
  ./output/logo<YYYYMMDDHHMMSS>.png
"""

from __future__ import annotations

import argparse
import os
import sys
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path

try:
    import numpy as np
except ModuleNotFoundError:
    print(
        "Missing Python deps (e.g. numpy). This project expects a virtualenv.\n"
        "  1) ./setup-python-env.sh\n"
        "  2) ./run-logo-detector.sh <m3u8_url>\n"
        "  or: .venv/bin/python logo_detector.py <m3u8_url>",
        file=sys.stderr,
    )
    sys.exit(1)

# Before OpenCV (may link Qt/GTK): avoid touching a real display / session bus.
os.environ.setdefault("QT_QPA_PLATFORM", "offscreen")
os.environ.setdefault("PYTHONIOENCODING", "utf-8")

from feature_extract import CORNER_FRACTION, Corner, corner_rois_bgr, extract_feature_vector
from logo_bbox_fusion import estimate_logo_local_bbox_multi, save_logo_frame_with_bbox
from logo_corner_refine import local_quadrant_to_frame_bbox, pick_logo_corner
from ffmpeg_frames import extract_frame_bgr_at_offset, ffprobe_duration_seconds
from m3u8_hls import (
    parse_media_playlist,
    resolve_media_playlist_url,
    sample_timestamps_in_window,
    total_duration_seconds,
)
# Last WINDOW_HOURS of content, one frame every INTERVAL_MINUTES (fewer if stream is shorter)
WINDOW_HOURS = 6.0
INTERVAL_MINUTES = 1.0
NUM_TEMPORAL_SAMPLES = max(1, int(WINDOW_HOURS * 60.0 / INTERVAL_MINUTES))
CORNER_ORDER = [Corner.TOP_LEFT, Corner.TOP_RIGHT, Corner.BOTTOM_LEFT, Corner.BOTTOM_RIGHT]


def _default_fetch_workers(n_tasks: int) -> int:
    """I/O-bound ffmpeg calls: use several threads per CPU core."""
    if n_tasks <= 1:
        return 1
    cpu = os.cpu_count() or 4
    return max(2, min(n_tasks, min(32, cpu * 4)))


def _decode_frames_parallel(
    media_url: str,
    times: list[float],
    max_workers: int,
    log,
    verbose: bool,
) -> list[np.ndarray | None]:
    n = len(times)
    out: list[np.ndarray | None] = [None] * n
    if n == 0:
        return out
    workers = max(1, min(max_workers, n))
    if verbose:
        log(f"Decoding {n} frames in parallel ({workers} workers)...")
    step = max(1, n // 10)
    done = 0
    with ThreadPoolExecutor(max_workers=workers) as ex:
        fut_to_idx = {
            ex.submit(extract_frame_bgr_at_offset, media_url, t): i for i, t in enumerate(times)
        }
        for fut in as_completed(fut_to_idx):
            idx = fut_to_idx[fut]
            try:
                out[idx] = fut.result()
            except Exception as exc:
                out[idx] = None
                if verbose:
                    log(f"  decode exception @ t={times[idx]:.2f}s: {exc}")
            done += 1
            if verbose and (done % step == 0 or done == n):
                log(f"  decode progress: {done}/{n}")
    return out


def _clamp_bbox(x: int, y: int, w: int, h: int, fw: int, fh: int) -> tuple[int, int, int, int]:
    x = max(0, min(x, max(0, fw - 1)))
    y = max(0, min(y, max(0, fh - 1)))
    w = max(1, min(w, fw - x))
    h = max(1, min(h, fh - y))
    return x, y, w, h


def run(
    m3u8_url: str,
    output_dir: Path | None = None,
    *,
    verbose: bool = True,
    fetch_workers: int = 0,
    structure_weight: float = 0.55,
) -> Path:
    def log(msg: str) -> None:
        if verbose:
            print(f"[logo-detector] {msg}", flush=True)

    root = Path(__file__).resolve().parent
    out = output_dir or (root / "output")

    log(f"Input: {m3u8_url}")
    log("Resolving playlist (if master, picking highest BANDWIDTH variant)...")
    media_url = resolve_media_playlist_url(m3u8_url)
    if media_url != m3u8_url:
        log(f"Using media playlist: {media_url}")

    log("Parsing media playlist...")
    parsed = parse_media_playlist(media_url)
    n_seg = len(parsed.segment_durations)
    log(f"Segments in playlist: {n_seg}")

    log("Querying duration (ffprobe)...")
    duration = ffprobe_duration_seconds(media_url)
    duration_source = "ffprobe"
    if duration is None or duration <= 0:
        duration = total_duration_seconds(parsed)
        duration_source = "sum of #EXTINF"

    if duration <= 0:
        raise RuntimeError("Could not determine playlist duration (ffprobe and EXTINF sum failed).")

    log(f"Duration: {duration:.1f}s (~{duration / 60.0:.1f} min) [{duration_source}]")

    times = sample_timestamps_in_window(
        duration,
        window_hours=WINDOW_HOURS,
        interval_minutes=INTERVAL_MINUTES,
        num_samples=NUM_TEMPORAL_SAMPLES,
    )
    log(
        f"Time window: last {WINDOW_HOURS:g}h, every {INTERVAL_MINUTES:g}min "
        f"-> {len(times)} seek positions (up to {NUM_TEMPORAL_SAMPLES} samples)"
    )

    workers = fetch_workers if fetch_workers > 0 else _default_fetch_workers(len(times))
    frames = _decode_frames_parallel(media_url, times, workers, log, verbose)

    by_roi: dict[Corner, list[np.ndarray]] = {c: [] for c in CORNER_ORDER}
    by_feat: dict[Corner, list[np.ndarray]] = {c: [] for c in CORNER_ORDER}
    full_frames: list[np.ndarray] = []
    frame_heights: list[int] = []
    frame_widths: list[int] = []
    frames_ok = 0
    seeks_failed = 0

    for i, t in enumerate(times):
        frame = frames[i]
        if frame is None:
            seeks_failed += 1
            if verbose:
                log(f"Frame {i + 1}/{len(times)} seek {t:.2f}s -> decode failed (skipped)")
            continue
        frames_ok += 1
        h, w = frame.shape[0], frame.shape[1]
        frame_heights.append(h)
        frame_widths.append(w)
        full_frames.append(frame.copy())
        rois = corner_rois_bgr(frame)
        for corner in CORNER_ORDER:
            roi = rois[corner]
            by_roi[corner].append(roi)
            by_feat[corner].append(extract_feature_vector(roi))

    n_per_corner = len(by_roi[CORNER_ORDER[0]])
    log(
        f"Extraction summary: {frames_ok} frames OK, {seeks_failed} seeks failed "
        f"-> {n_per_corner} samples per corner"
    )

    if n_per_corner < 2:
        raise RuntimeError(
            f"Too few frames extracted ({n_per_corner}). "
            "Check ffmpeg connectivity and that the playlist is seekable VOD or has enough window."
        )

    by_X: dict[Corner, np.ndarray] = {c: np.vstack(by_feat[c]) for c in CORNER_ORDER}

    log(
        "Stage 1: scoring corners (cohesion + edge-on-stable structure; "
        "minimize combined = cohesion - w*structure_norm)..."
    )
    pick = pick_logo_corner(by_X, by_roi, structure_weight=structure_weight)
    winning = pick.corner
    coh_str = ", ".join(
        f"{c.value}={pick.cohesion[c]:.4f}" for c in CORNER_ORDER if pick.cohesion[c] < float("inf")
    )
    str_str = ", ".join(f"{c.value}={pick.structure[c]:.4f}" for c in CORNER_ORDER)
    comb_str = ", ".join(f"{c.value}={pick.combined[c]:.4f}" for c in CORNER_ORDER if pick.combined[c] < float("inf"))
    log(f"  cohesion (lower=better): {coh_str}")
    log(f"  structure (higher=better, logo-like): {str_str}")
    log(f"  combined (lower=wins): {comb_str}")
    log(f"  -> selected corner: {winning.value}")

    winning_patches = by_roi[winning]
    ref_mh = int(np.median([p.shape[0] for p in winning_patches]))
    ref_mw = int(np.median([p.shape[1] for p in winning_patches]))

    log(
        f"Stage 2: logo bbox fusion (ref quadrant {ref_mw}x{ref_mh}), "
        "strategies: temporal_variance_otsu | median_color_consensus | stable_high_edges"
    )
    (lx, ly, lw, lh), breakdown = estimate_logo_local_bbox_multi(winning_patches)
    for name, box in breakdown.items():
        log(f"  {name}: local x={box[0]}, y={box[1]}, w={box[2]}, h={box[3]}")
    log(f"  fused (local): x={lx}, y={ly}, w={lw}, h={lh}")

    if not full_frames:
        raise RuntimeError("No full frames available for logo preview (internal error).")

    rep_idx = len(full_frames) // 2
    display_bgr = full_frames[rep_idx]
    dh, dw = display_bgr.shape[0], display_bgr.shape[1]

    gx, gy, gw, gh = local_quadrant_to_frame_bbox(
        winning,
        dh,
        dw,
        CORNER_FRACTION,
        lx,
        ly,
        lw,
        lh,
        ref_quadrant_h=ref_mh,
        ref_quadrant_w=ref_mw,
    )
    gx, gy, gw, gh = _clamp_bbox(gx, gy, gw, gh, dw, dh)
    log(
        f"  frame bbox on representative frame #{rep_idx + 1}/{len(full_frames)} ({dw}x{dh}): "
        f"x={gx}, y={gy}, w={gw}, h={gh}"
    )

    log(f"Saving logo preview with red ROI -> {out.resolve()} ...")
    path = save_logo_frame_with_bbox(display_bgr, gx, gy, gw, gh, out)
    return path


def _restore_terminal() -> None:
    """
    Reset common TTY/ANSI states left behind by GUI-linked libs or subprocesses.
    """
    reset = (
        "\033[0m"  # SGR reset
        "\033[?25h"  # show cursor
        "\033[?1049l"  # leave alternate screen buffer
        "\033[?2004l"  # bracketed paste off
    )
    for stream in (sys.stdout, sys.stderr):
        try:
            if stream.isatty():
                stream.write(reset)
                stream.flush()
        except Exception:
            pass


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Logo detector: corner selection, multi-strategy logo bbox, PNG with red ROI."
    )
    parser.add_argument("m3u8_url", help="URL or path to .m3u8 (master or media playlist)")
    parser.add_argument(
        "--output-dir",
        type=Path,
        default=None,
        help="Directory for logo PNG (default: ./output next to this script)",
    )
    parser.add_argument(
        "--quiet",
        "-q",
        action="store_true",
        help="Suppress progress messages (only errors / final path)",
    )
    parser.add_argument(
        "--fetch-workers",
        type=int,
        default=0,
        metavar="N",
        help="Parallel ffmpeg frame decodes (0 = auto, based on CPU count)",
    )
    parser.add_argument(
        "--structure-weight",
        type=float,
        default=0.55,
        metavar="W",
        help="Corner pick: weight for edge-on-stable vs feature cohesion (default: 0.55)",
    )
    args = parser.parse_args()

    exit_code = 0
    try:
        out = run(
            args.m3u8_url,
            args.output_dir,
            verbose=not args.quiet,
            fetch_workers=args.fetch_workers,
            structure_weight=args.structure_weight,
        )
        print(f"Wrote {out}", flush=True)
    except Exception as e:
        print(f"Error: {e}", file=sys.stderr)
        exit_code = 1
    finally:
        _restore_terminal()
    if exit_code:
        sys.exit(exit_code)


if __name__ == "__main__":
    main()
