"""Commercial-overlay detection (CPU, OpenCV).

Broadcast ads and promo slates tend to paint large graphic regions: full-width lower-third
banners (zocalos), corner logos/short-code badges and busy edge-dense placas. We detect these
cheaply without any ML by combining:

  1. Edge density per screen region (Canny) — banners/placas have far more edges than a talking
     head or a wide sports shot.
  2. Large solid contours (filled graphic boxes) via contour area over a threshold.
  3. Text geometry from the OCR pass (word boxes) — clusters of text in the bottom third or a
     corner reinforce lower-third / logo-badge overlays.

Returns per-frame-aggregated boolean flags + a coarse `overlay_score` (0..1) the fusion layer
can weigh as ad evidence. Everything is averaged across the frames handed in.
"""

import os
import threading

import cv2
import numpy as np

# Region bands (fractions of height). Lower third = bottom band, where most tickers/zocalos live.
LOWER_THIRD_TOP = 0.66
# Corner box (top-left / top-right) fraction for logo / short-code badges.
CORNER_FRAC = 0.28


def _edge_density(gray: np.ndarray) -> float:
    edges = cv2.Canny(gray, 80, 200)
    if edges.size == 0:
        return 0.0
    return float(np.count_nonzero(edges)) / float(edges.size)


class OverlayDetector:
    def __init__(self):
        self._lock = threading.Lock()
        # Tunable thresholds (env-overridable) — kept generous since broadcast graphics vary a lot.
        self.lower_third_edge_th = _float_env("OVERLAY_LOWER_THIRD_EDGE", 0.09)
        self.banner_contour_area_frac = _float_env("OVERLAY_BANNER_AREA_FRAC", 0.12)
        self.corner_edge_th = _float_env("OVERLAY_CORNER_EDGE", 0.10)

    def _analyze_frame(self, path: str, boxes: list[dict] | None):
        img = cv2.imread(path, cv2.IMREAD_COLOR)
        if img is None:
            return None
        h, w = img.shape[:2]
        if h == 0 or w == 0:
            return None
        gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)

        # --- Lower third: edge density in the bottom band --------------------------------------
        lt_top = int(h * LOWER_THIRD_TOP)
        lower = gray[lt_top:h, 0:w]
        lower_edges = _edge_density(lower) if lower.size else 0.0
        lower_third = lower_edges >= self.lower_third_edge_th

        # --- Corner badges: edge density in top-left / top-right corners -----------------------
        cw, ch = int(w * CORNER_FRAC), int(h * CORNER_FRAC)
        tl = _edge_density(gray[0:ch, 0:cw]) if ch and cw else 0.0
        tr = _edge_density(gray[0:ch, w - cw : w]) if ch and cw else 0.0
        logo_region = max(tl, tr) >= self.corner_edge_th

        # --- Large solid contours (filled graphic boxes / banners) -----------------------------
        thresh = cv2.threshold(gray, 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU)[1]
        contours, _ = cv2.findContours(thresh, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
        frame_area = float(w * h)
        biggest = 0.0
        for c in contours:
            area = cv2.contourArea(c)
            if area > biggest:
                biggest = area
        banner = frame_area > 0 and (biggest / frame_area) >= self.banner_contour_area_frac

        # --- OCR text geometry reinforcement ---------------------------------------------------
        # Clusters of recognized words in the bottom band or a top corner strengthen the flags.
        text_lower = 0
        text_corner = 0
        for b in boxes or []:
            cx = (b.get("x0", 0) + b.get("x1", 0)) / 2.0
            cy = (b.get("y0", 0) + b.get("y1", 0)) / 2.0
            if cy >= lt_top:
                text_lower += 1
            if cy <= ch and (cx <= cw or cx >= w - cw):
                text_corner += 1
        if text_lower >= 2:
            lower_third = True
        if text_corner >= 1:
            logo_region = True

        overlay = lower_third or banner or logo_region
        # Coarse score: blend the strongest edge signal with the flag count.
        flag_count = sum([lower_third, banner, logo_region])
        score = min(1.0, 0.4 * flag_count + 0.6 * max(lower_edges, tl, tr))

        return {
            "lower_third": lower_third,
            "banner": banner,
            "logo_region": logo_region,
            "overlay": overlay,
            "score": score,
        }

    def analyze_frames(self, frame_paths: list[str], boxes_per_frame: list[list] | None = None) -> dict:
        boxes_per_frame = boxes_per_frame or []
        lower = banner = logo = overlay = 0
        used = 0
        score_sum = 0.0

        with self._lock:
            for idx, p in enumerate(frame_paths):
                boxes = boxes_per_frame[idx] if idx < len(boxes_per_frame) else None
                r = self._analyze_frame(p, boxes)
                if r is None:
                    continue
                used += 1
                lower += int(r["lower_third"])
                banner += int(r["banner"])
                logo += int(r["logo_region"])
                overlay += int(r["overlay"])
                score_sum += r["score"]

        if used == 0:
            return {
                "overlay_present": False,
                "lower_third_present": False,
                "banner_present": False,
                "logo_region_present": False,
                "overlay_score": 0.0,
                "overlay_frame_ratio": 0.0,
            }

        # A flag is "present" for the window if it fired in at least ~40% of the analyzed frames
        # (sustained overlay, not a one-frame flash).
        def present(count):
            return (count / used) >= 0.4

        return {
            "overlay_present": present(overlay),
            "lower_third_present": present(lower),
            "banner_present": present(banner),
            "logo_region_present": present(logo),
            "overlay_score": round(score_sum / used, 4),
            "overlay_frame_ratio": round(overlay / used, 4),
        }


def _float_env(name: str, default: float) -> float:
    try:
        return float(os.environ.get(name, str(default)))
    except (TypeError, ValueError):
        return default
