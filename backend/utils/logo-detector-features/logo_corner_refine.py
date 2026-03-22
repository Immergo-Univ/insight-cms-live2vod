"""
Two-stage logo localization: pick corner by cohesion + temporal structure, refine bbox via temporal variance.
"""

from __future__ import annotations

from dataclasses import dataclass

import cv2
import numpy as np
from sklearn.preprocessing import StandardScaler

from feature_extract import Corner


def _stack_aligned_grays(patches_bgr: list[np.ndarray]) -> tuple[np.ndarray, int, int]:
    """Resize patches to median H×W and return stack (T,H,W) float32."""
    if not patches_bgr:
        raise ValueError("empty patches")
    mh = max(1, int(np.median([p.shape[0] for p in patches_bgr])))
    mw = max(1, int(np.median([p.shape[1] for p in patches_bgr])))
    grays: list[np.ndarray] = []
    for p in patches_bgr:
        if p.shape[0] != mh or p.shape[1] != mw:
            p = cv2.resize(p, (mw, mh), interpolation=cv2.INTER_AREA)
        grays.append(cv2.cvtColor(p, cv2.COLOR_BGR2GRAY).astype(np.float32))
    return np.stack(grays, axis=0), mh, mw


def temporal_structure_logo_score(patches_bgr: list[np.ndarray]) -> float:
    """
    Higher when temporally stable pixels carry strong edges (graphics / logo).
    Down-weights corners that are uniformly stable but flat (e.g. sky).
    """
    if len(patches_bgr) < 2:
        return 0.0
    G, _, _ = _stack_aligned_grays(patches_bgr)
    std_map = np.std(G, axis=0)
    p_lo = float(np.percentile(std_map, 22))
    stable = std_map <= p_lo
    frac = float(np.mean(stable))
    if frac < 0.012:
        return 0.0

    med = np.median(G, axis=0).astype(np.float32)
    gx = cv2.Sobel(med, cv2.CV_32F, 1, 0, ksize=3)
    gy = cv2.Sobel(med, cv2.CV_32F, 0, 1, ksize=3)
    mag = np.sqrt(gx * gx + gy * gy)
    mean_mag = float(np.mean(mag)) + 1e-6
    edge_on_stable = float(np.mean(mag[stable]))
    ratio = edge_on_stable / mean_mag

    # Penalize "all stable but textureless" (clear sky, flat wall)
    penalty = 1.0
    if frac > 0.88:
        penalty = max(0.2, 1.0 - 3.0 * (frac - 0.88))

    return ratio * penalty * np.sqrt(frac + 0.04)


def _cohesion_per_corner(by_corner_features: dict[Corner, np.ndarray]) -> dict[Corner, float]:
    scores: dict[Corner, float] = {}
    for c, X in by_corner_features.items():
        if X.shape[0] < 2:
            scores[c] = float("inf")
            continue
        Xs = StandardScaler().fit_transform(X)
        centroid = np.mean(Xs, axis=0)
        mean_dist = float(np.mean(np.linalg.norm(Xs - centroid, axis=1)))
        trace_cov = float(np.trace(np.cov(Xs, rowvar=False)))
        scores[c] = mean_dist + 0.02 * trace_cov
    return scores


@dataclass(frozen=True)
class CornerPickResult:
    corner: Corner
    """Minimize `combined`; cohesion lower is better; structure higher is better."""

    combined: dict[Corner, float]
    cohesion: dict[Corner, float]
    structure: dict[Corner, float]


def pick_logo_corner(
    by_corner_features: dict[Corner, np.ndarray],
    by_corner_patches: dict[Corner, list[np.ndarray]],
    *,
    structure_weight: float = 0.55,
) -> CornerPickResult:
    """
    Pick corner using:
      - cohesion: tight feature cloud over time (legacy signal; can favor bland static areas)
      - structure: Sobel energy on temporally stable pixels (favors graphics / logos over flat sky)
    combined = cohesion - structure_weight * structure_01 (minimize).
    """
    cohesion = _cohesion_per_corner(by_corner_features)
    structure: dict[Corner, float] = {}
    for c in cohesion:
        patches = by_corner_patches.get(c, [])
        structure[c] = temporal_structure_logo_score(patches) if len(patches) >= 2 else 0.0

    s_vals = [structure[c] for c in structure if cohesion[c] < float("inf")]
    s_min = min(s_vals) if s_vals else 0.0
    s_max = max(s_vals) if s_vals else 1.0
    span = s_max - s_min

    combined: dict[Corner, float] = {}
    for c in cohesion:
        if cohesion[c] == float("inf"):
            combined[c] = float("inf")
            continue
        if span > 1e-8:
            s_01 = (structure[c] - s_min) / span
        else:
            s_01 = 0.5
        combined[c] = cohesion[c] - structure_weight * s_01

    best = min(combined, key=lambda k: combined[k])
    return CornerPickResult(corner=best, combined=combined, cohesion=cohesion, structure=structure)


def refine_quadrant_local_bbox(patches_bgr: list[np.ndarray]) -> tuple[int, int, int, int]:
    """
    Within one corner quadrant, estimate a tighter (x, y, w, h) in quadrant pixel coordinates
    using per-pixel temporal std (stable regions = candidate logo).
    Falls back to full quadrant if masks are empty.
    """
    if not patches_bgr:
        return 0, 0, 0, 0
    if len(patches_bgr) == 1:
        p0 = patches_bgr[0]
        return 0, 0, p0.shape[1], p0.shape[0]

    G, mh, mw = _stack_aligned_grays(patches_bgr)
    std_map = np.std(G, axis=0)
    smax = float(np.max(std_map)) or 1.0
    std_u8 = np.clip(std_map / smax * 255.0, 0, 255).astype(np.uint8)

    # Low temporal std -> foreground (logo / static graphics)
    _, bin_img = cv2.threshold(std_u8, 0, 255, cv2.THRESH_BINARY_INV + cv2.THRESH_OTSU)
    mask = (bin_img > 0).astype(np.uint8) * 255

    k = max(3, min(mh, mw) // 40)
    if k % 2 == 0:
        k += 1
    kernel = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (k, k))
    mask = cv2.morphologyEx(mask, cv2.MORPH_CLOSE, kernel)
    k2 = max(3, k - 2)
    if k2 % 2 == 0:
        k2 += 1
    kernel2 = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (k2, k2))
    mask = cv2.morphologyEx(mask, cv2.MORPH_OPEN, kernel2)

    cnts, _ = cv2.findContours(mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    min_area = max(80, int((mh * mw) * 0.0015))
    cnts = [c for c in cnts if cv2.contourArea(c) >= min_area]
    if not cnts:
        return 0, 0, mw, mh

    c = max(cnts, key=cv2.contourArea)
    x, y, w, h = cv2.boundingRect(c)
    pad = max(1, min(mh, mw) // 64)
    x = max(0, x - pad)
    y = max(0, y - pad)
    w = min(mw - x, w + 2 * pad)
    h = min(mh - y, h + 2 * pad)
    return x, y, w, h


def local_quadrant_to_frame_bbox(
    corner: Corner,
    frame_h: int,
    frame_w: int,
    fraction: float,
    lx: int,
    ly: int,
    lw: int,
    lh: int,
    *,
    ref_quadrant_h: int,
    ref_quadrant_w: int,
) -> tuple[int, int, int, int]:
    """
    Map quadrant-local bbox (from refinement on ref-sized patches) to full-frame pixels.
    Scales local coords when the target frame quadrant size differs from ref quadrant size.
    """
    cw = max(1, int(frame_w * fraction))
    ch = max(1, int(frame_h * fraction))
    rqw = max(1, ref_quadrant_w)
    rqh = max(1, ref_quadrant_h)
    sx = cw / float(rqw)
    sy = ch / float(rqh)
    qlx = int(round(lx * sx))
    qly = int(round(ly * sy))
    qlw = max(1, int(round(lw * sx)))
    qlh = max(1, int(round(lh * sy)))

    if corner == Corner.TOP_LEFT:
        gx, gy = qlx, qly
    elif corner == Corner.TOP_RIGHT:
        gx, gy = (frame_w - cw) + qlx, qly
    elif corner == Corner.BOTTOM_LEFT:
        gx, gy = qlx, (frame_h - ch) + qly
    else:
        gx, gy = (frame_w - cw) + qlx, (frame_h - ch) + qly
    return gx, gy, qlw, qlh
