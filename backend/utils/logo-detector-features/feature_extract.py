"""
Corner ROI crops and hand-crafted feature vectors (histogram + edges/contours).
"""

from __future__ import annotations

from enum import Enum

import cv2
import numpy as np

try:
    cv2.setNumThreads(1)
    cv2.utils.logging.setLogLevel(cv2.utils.logging.LOG_LEVEL_ERROR)
except Exception:
    pass

CORNER_FRACTION = 0.25


class Corner(str, Enum):
    TOP_LEFT = "tl"
    TOP_RIGHT = "tr"
    BOTTOM_LEFT = "bl"
    BOTTOM_RIGHT = "br"


def corner_rois_bgr(frame_bgr: np.ndarray, fraction: float = CORNER_FRACTION) -> dict[Corner, np.ndarray]:
    h, w = frame_bgr.shape[:2]
    cw = max(1, int(w * fraction))
    ch = max(1, int(h * fraction))
    return {
        Corner.TOP_LEFT: frame_bgr[0:ch, 0:cw].copy(),
        Corner.TOP_RIGHT: frame_bgr[0:ch, w - cw : w].copy(),
        Corner.BOTTOM_LEFT: frame_bgr[h - ch : h, 0:cw].copy(),
        Corner.BOTTOM_RIGHT: frame_bgr[h - ch : h, w - cw : w].copy(),
    }


def extract_feature_vector(roi_bgr: np.ndarray) -> np.ndarray:
    """
    Build a fixed-length descriptor: color histograms + edge/contour stats.
    """
    if roi_bgr is None or roi_bgr.size == 0:
        return np.zeros(_feature_dim(), dtype=np.float64)

    roi = roi_bgr
    h, w = roi.shape[:2]
    area = float(h * w) or 1.0

    feats: list[np.ndarray] = []

    # BGR histogram (16 bins per channel), normalized
    bins = 16
    for ch in range(3):
        hist = cv2.calcHist([roi], [ch], None, [bins], [0, 256]).flatten()
        hist = hist / (hist.sum() + 1e-8)
        feats.append(hist.astype(np.float64))

    gray = cv2.cvtColor(roi, cv2.COLOR_BGR2GRAY)
    gh = cv2.calcHist([gray], [0], None, [bins], [0, 256]).flatten()
    gh = gh / (gh.sum() + 1e-8)
    feats.append(gh.astype(np.float64))

    # Edges
    edges = cv2.Canny(gray, 80, 160)
    edge_density = float(np.count_nonzero(edges)) / area

    # Contours (external)
    cnts, _ = cv2.findContours(edges, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    n_contours = min(len(cnts), 500)
    areas = [float(cv2.contourArea(c)) for c in cnts]
    largest = max(areas) if areas else 0.0
    largest_ratio = largest / area
    total_contour_area = sum(a for a in areas if a > 0) / area

    gray_mean = float(np.mean(gray)) / 255.0
    gray_std = float(np.std(gray)) / 255.0

    hsv = cv2.cvtColor(roi, cv2.COLOR_BGR2HSV)
    sat_mean = float(np.mean(hsv[:, :, 1])) / 255.0
    val_mean = float(np.mean(hsv[:, :, 2])) / 255.0

    extra = np.array(
        [
            edge_density,
            np.log1p(n_contours) / 10.0,
            largest_ratio,
            min(total_contour_area, 5.0) / 5.0,
            gray_mean,
            gray_std,
            sat_mean,
            val_mean,
        ],
        dtype=np.float64,
    )
    feats.append(extra)

    return np.concatenate(feats, axis=0)


def _feature_dim() -> int:
    # 3 * 16 (BGR) + 16 (gray) + 8 (extra) = 72
    return 16 * 4 + 8
