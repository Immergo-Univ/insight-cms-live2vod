"""
Multiple strategies to estimate logo bounding box inside the winning corner quadrant (local coords).
"""

from __future__ import annotations

from datetime import datetime
from pathlib import Path

import cv2
import numpy as np

from logo_corner_refine import _stack_aligned_grays, refine_quadrant_local_bbox


def bbox_temporal_variance_otsu(patches_bgr: list[np.ndarray]) -> tuple[int, int, int, int]:
    """Low temporal variance + Otsu + morphology (same as refine_quadrant_local_bbox)."""
    return refine_quadrant_local_bbox(patches_bgr)


def bbox_median_color_consensus(
    patches_bgr: list[np.ndarray],
    *,
    channel_diff_tol: float = 22.0,
    min_agree_frac: float = 0.52,
) -> tuple[int, int, int, int]:
    """
    Pixels where most frames agree with the per-pixel median color (static overlay / logo).
    """
    if not patches_bgr:
        return 0, 0, 0, 0
    if len(patches_bgr) == 1:
        p0 = patches_bgr[0]
        return 0, 0, p0.shape[1], p0.shape[0]

    mh = max(1, int(np.median([p.shape[0] for p in patches_bgr])))
    mw = max(1, int(np.median([p.shape[1] for p in patches_bgr])))
    stack: list[np.ndarray] = []
    for p in patches_bgr:
        if p.shape[0] != mh or p.shape[1] != mw:
            p = cv2.resize(p, (mw, mh), interpolation=cv2.INTER_AREA)
        stack.append(p.astype(np.float32))
    S = np.stack(stack, axis=0)
    med = np.median(S, axis=0)
    diff_max = np.max(np.abs(S - med[np.newaxis, ...]), axis=3)
    agree = np.mean(diff_max < channel_diff_tol, axis=0)
    mask = ((agree >= min_agree_frac).astype(np.uint8) * 255)

    k = max(3, min(mh, mw) // 35)
    if k % 2 == 0:
        k += 1
    kernel = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (k, k))
    mask = cv2.morphologyEx(mask, cv2.MORPH_CLOSE, kernel)
    mask = cv2.morphologyEx(mask, cv2.MORPH_OPEN, kernel)

    cnts, _ = cv2.findContours(mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    min_area = max(64, int((mh * mw) * 0.0012))
    cnts = [c for c in cnts if cv2.contourArea(c) >= min_area]
    if not cnts:
        return 0, 0, mw, mh

    c = max(cnts, key=cv2.contourArea)
    x, y, w, h = cv2.boundingRect(c)
    pad = max(1, min(mh, mw) // 80)
    x = max(0, x - pad)
    y = max(0, y - pad)
    w = min(mw - x, w + 2 * pad)
    h = min(mh - y, h + 2 * pad)
    return x, y, w, h


def bbox_stable_region_strong_edges(patches_bgr: list[np.ndarray]) -> tuple[int, int, int, int]:
    """Temporal low-var mask AND strong Sobel on median frame (graphic edges)."""
    if not patches_bgr:
        return 0, 0, 0, 0
    if len(patches_bgr) == 1:
        p0 = patches_bgr[0]
        return 0, 0, p0.shape[1], p0.shape[0]

    G, mh, mw = _stack_aligned_grays(patches_bgr)
    std_map = np.std(G, axis=0)
    p_lo = float(np.percentile(std_map, 28))
    stable = std_map <= p_lo

    med = np.median(G, axis=0).astype(np.float32)
    gx = cv2.Sobel(med, cv2.CV_32F, 1, 0, ksize=3)
    gy = cv2.Sobel(med, cv2.CV_32F, 0, 1, ksize=3)
    mag = np.sqrt(gx * gx + gy * gy)
    vals = mag[stable]
    if vals.size < 50 or float(np.max(vals)) < 1e-3:
        return 0, 0, mw, mh

    thr = float(np.percentile(vals, 65))
    m = np.zeros((mh, mw), dtype=np.uint8)
    m[(mag >= thr) & stable] = 255

    kd = max(3, min(mh, mw) // 50)
    if kd % 2 == 0:
        kd += 1
    kernel = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (kd, kd))
    m = cv2.morphologyEx(m, cv2.MORPH_CLOSE, kernel)
    m = cv2.morphologyEx(m, cv2.MORPH_OPEN, kernel)

    cnts, _ = cv2.findContours(m, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    min_area = max(48, int((mh * mw) * 0.0008))
    cnts = [c for c in cnts if cv2.contourArea(c) >= min_area]
    if not cnts:
        return 0, 0, mw, mh

    c = max(cnts, key=cv2.contourArea)
    x, y, w, h = cv2.boundingRect(c)
    pad = max(1, min(mh, mw) // 70)
    x = max(0, x - pad)
    y = max(0, y - pad)
    w = min(mw - x, w + 2 * pad)
    h = min(mh - y, h + 2 * pad)
    return x, y, w, h


def _intersect_boxes(boxes: list[tuple[int, int, int, int]]) -> tuple[int, int, int, int] | None:
    if len(boxes) < 2:
        return None
    x0 = max(b[0] for b in boxes)
    y0 = max(b[1] for b in boxes)
    x1 = min(b[0] + b[2] for b in boxes)
    y1 = min(b[1] + b[3] for b in boxes)
    if x1 <= x0 or y1 <= y0:
        return None
    return x0, y0, x1 - x0, y1 - y0


def fuse_logo_local_bboxes(
    boxes: list[tuple[int, int, int, int]],
    mw: int,
    mh: int,
    *,
    min_intersection_area_ratio: float = 0.0015,
) -> tuple[int, int, int, int]:
    """
    Prefer intersection of all strategies if large enough; else median of box parameters.
    """
    valid = [b for b in boxes if b[2] >= 6 and b[3] >= 6 and b[0] >= 0 and b[1] >= 0]
    if not valid:
        return 0, 0, mw, mh

    inter = _intersect_boxes(valid)
    min_area = min_intersection_area_ratio * mw * mh
    if inter is not None and inter[2] * inter[3] >= min_area:
        return inter

    xs = [b[0] for b in valid]
    ys = [b[1] for b in valid]
    ws = [b[2] for b in valid]
    hs = [b[3] for b in valid]
    return (
        int(np.median(xs)),
        int(np.median(ys)),
        int(np.median(ws)),
        int(np.median(hs)),
    )


def estimate_logo_local_bbox_multi(patches_bgr: list[np.ndarray]) -> tuple[tuple[int, int, int, int], dict[str, tuple[int, int, int, int]]]:
    """Run all strategies and return fused local (x,y,w,h) plus per-strategy boxes."""
    mh = max(1, int(np.median([p.shape[0] for p in patches_bgr]))) if patches_bgr else 1
    mw = max(1, int(np.median([p.shape[1] for p in patches_bgr]))) if patches_bgr else 1

    b_var = bbox_temporal_variance_otsu(patches_bgr)
    b_med = bbox_median_color_consensus(patches_bgr)
    b_edge = bbox_stable_region_strong_edges(patches_bgr)

    breakdown = {
        "temporal_variance_otsu": b_var,
        "median_color_consensus": b_med,
        "stable_high_edges": b_edge,
    }
    fused = fuse_logo_local_bboxes([b_var, b_med, b_edge], mw, mh)
    return fused, breakdown


def save_logo_frame_with_bbox(
    frame_bgr: np.ndarray,
    gx: int,
    gy: int,
    gw: int,
    gh: int,
    output_dir: Path,
    *,
    border_bgr: tuple[int, int, int] = (0, 0, 255),
) -> Path:
    """Draw red (default) rectangle on frame and save as logo<timestamp>.png."""
    output_dir.mkdir(parents=True, exist_ok=True)
    stamp = datetime.now().strftime("%Y%m%d%H%M%S")
    out_path = output_dir / f"logo{stamp}.png"

    fh, fw = frame_bgr.shape[:2]
    gx = max(0, min(gx, fw - 1))
    gy = max(0, min(gy, fh - 1))
    gw = max(1, min(gw, fw - gx))
    gh = max(1, min(gh, fh - gy))

    vis = frame_bgr.copy()
    thickness = max(2, min(fw, fh) // 350)
    cv2.rectangle(vis, (gx, gy), (gx + gw - 1, gy + gh - 1), border_bgr, thickness, lineType=cv2.LINE_AA)
    cv2.imwrite(str(out_path), vis)
    return out_path
