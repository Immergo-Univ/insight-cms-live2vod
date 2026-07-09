"""Channel-logo ROI detection + matching (CPU, OpenCV).

Broadcast channels keep a static logo bug in a screen corner during programming and usually REMOVE
it during ad breaks. We exploit that:

  1. detect_roi(frames): on the first runs (before we have samples) auto-locate the logo by
     temporal stability — the logo region barely changes across frames while the rest of the
     picture moves, and it has real edge content (it's a graphic, not flat sky). We score the four
     screen corners and return the best one as a normalized ROI, plus a crop of it (the sample).

  2. match(frames, roi, templates): once we have logo template crops, template-match the ROI of
     every frame against them. A high normalized-correlation = logo present (program); a drop =
     logo gone (ad). The first present->absent frame is the pixel-perfect program->ad boundary
     (temporal resolution = the frame step, i.e. 1 s at 1 fps).

All coordinates are normalized fractions [x0, y0, x1, y1] of width/height so they're resolution
independent.
"""

import base64
import os

import cv2
import numpy as np

# Candidate corner regions (normalized x0,y0,x1,y1) where broadcast logos usually sit.
_CORNER_CANDIDATES = {
    "top-left": (0.010, 0.020, 0.230, 0.180),
    "top-right": (0.770, 0.020, 0.990, 0.180),
    "bottom-left": (0.010, 0.800, 0.230, 0.980),
    "bottom-right": (0.770, 0.800, 0.990, 0.980),
}


def _f(name, default):
    try:
        return float(os.environ.get(name, str(default)))
    except (TypeError, ValueError):
        return default


# Tunables.
STABILITY_MIN = _f("LOGO_STABILITY_MIN", 0.86)   # 1 - normalized temporal diff must exceed this
EDGE_MIN = _f("LOGO_EDGE_MIN", 0.04)             # ROI must have some edge content (a graphic)
MATCH_THRESHOLD = _f("LOGO_MATCH_THRESHOLD", 0.50)  # NCC >= this => logo present
_MATCH_SIZE = (128, 96)  # templates + ROI crops resized to this for correlation


def _read_gray(path):
    img = cv2.imread(path, cv2.IMREAD_GRAYSCALE)
    return img


def _crop_norm(img, roi):
    h, w = img.shape[:2]
    x0 = max(0, int(round(roi[0] * w)))
    y0 = max(0, int(round(roi[1] * h)))
    x1 = min(w, int(round(roi[2] * w)))
    y1 = min(h, int(round(roi[3] * h)))
    if x1 <= x0 or y1 <= y0:
        return None
    return img[y0:y1, x0:x1]


def _edge_density(gray):
    if gray is None or gray.size == 0:
        return 0.0
    edges = cv2.Canny(gray, 80, 200)
    return float(np.count_nonzero(edges)) / float(edges.size or 1)


def detect_roi(frame_paths: list[str]) -> dict:
    """Auto-locate the logo corner via temporal stability + edge content.

    Returns {roi, confidence, sample_base64} or {roi: None, ...} when no stable logo is found."""
    grays = []
    for p in frame_paths:
        g = _read_gray(p)
        if g is not None:
            grays.append(g)
    if len(grays) < 2:
        return {"roi": None, "confidence": 0.0, "sample_base64": None}

    # Use a common size for temporal diffing (frames may vary slightly).
    h = min(g.shape[0] for g in grays)
    w = min(g.shape[1] for g in grays)
    grays = [cv2.resize(g, (w, h)) for g in grays]

    best = None
    for name, roi in _CORNER_CANDIDATES.items():
        crops = [_crop_norm(g, roi) for g in grays]
        crops = [c for c in crops if c is not None and c.size]
        if len(crops) < 2:
            continue
        # Temporal stability: mean absolute frame-to-frame diff over the region (0 = identical).
        diffs = []
        for i in range(1, len(crops)):
            a, b = crops[i - 1], crops[i]
            if a.shape != b.shape:
                b = cv2.resize(b, (a.shape[1], a.shape[0]))
            diffs.append(float(np.mean(np.abs(a.astype(np.int16) - b.astype(np.int16)))) / 255.0)
        stability = 1.0 - (sum(diffs) / len(diffs) if diffs else 1.0)
        edge = _edge_density(crops[len(crops) // 2])
        score = stability * 0.7 + min(1.0, edge / 0.15) * 0.3
        cand = {"name": name, "roi": roi, "stability": stability, "edge": edge, "score": score}
        if best is None or cand["score"] > best["score"]:
            best = cand

    if best is None or best["stability"] < STABILITY_MIN or best["edge"] < EDGE_MIN:
        return {
            "roi": None,
            "confidence": round(float(best["score"]), 4) if best else 0.0,
            "sample_base64": None,
        }

    roi = best["roi"]
    # Crop the sample from a mid frame in COLOR for a nice catalog thumbnail.
    mid_path = frame_paths[len(frame_paths) // 2]
    color = cv2.imread(mid_path, cv2.IMREAD_COLOR)
    sample_b64 = None
    if color is not None:
        crop = _crop_norm(color, roi)
        if crop is not None and crop.size:
            ok, buf = cv2.imencode(".jpg", crop, [cv2.IMWRITE_JPEG_QUALITY, 90])
            if ok:
                sample_b64 = base64.b64encode(buf.tobytes()).decode("ascii")

    return {
        "roi": {"x0": roi[0], "y0": roi[1], "x1": roi[2], "y1": roi[3]},
        "confidence": round(float(best["score"]), 4),
        "stability": round(float(best["stability"]), 4),
        "edge": round(float(best["edge"]), 4),
        "sample_base64": sample_b64,
    }


def _prep(gray):
    return cv2.resize(gray, _MATCH_SIZE) if gray is not None and gray.size else None


def _ncc(a, b):
    """Normalized cross-correlation coefficient between two same-size grayscale patches (-1..1)."""
    if a is None or b is None:
        return 0.0
    res = cv2.matchTemplate(a, b, cv2.TM_CCOEFF_NORMED)
    return float(res.max()) if res.size else 0.0


def _decode_templates(templates_b64: list[str]):
    out = []
    for b64 in templates_b64 or []:
        try:
            raw = base64.b64decode(b64)
            arr = np.frombuffer(raw, dtype=np.uint8)
            img = cv2.imdecode(arr, cv2.IMREAD_GRAYSCALE)
            prepped = _prep(img)
            if prepped is not None:
                out.append(prepped)
        except Exception:
            continue
    return out


def match(frame_paths: list[str], roi: dict, templates_b64: list[str]) -> dict:
    """Template-match the ROI of each frame against the logo templates.

    Returns per-frame presence + the present->absent transition index (program->ad boundary)."""
    templates = _decode_templates(templates_b64)
    roi_t = (roi.get("x0", 0), roi.get("y0", 0), roi.get("x1", 0), roi.get("y1", 0))
    per_frame = []

    for p in frame_paths:
        g = _read_gray(p)
        crop = _prep(_crop_norm(g, roi_t)) if g is not None else None
        if crop is None or not templates:
            per_frame.append({"present": False, "score": 0.0})
            continue
        score = max(_ncc(crop, t) for t in templates)
        per_frame.append({"present": bool(score >= MATCH_THRESHOLD), "score": round(score, 4)})

    n = len(per_frame)
    present_flags = [f["present"] for f in per_frame]
    present_ratio = (sum(1 for x in present_flags if x) / n) if n else 0.0

    # Transition = first frame index where the logo goes present -> absent (and stays absent).
    transition_index = None
    for i in range(1, n):
        if present_flags[i - 1] and not present_flags[i]:
            # confirm it stays absent for the rest of the window (avoids single-frame OCR noise)
            if not any(present_flags[i:]):
                transition_index = i
                break

    return {
        "present": bool(present_flags and present_flags[-1]),
        "present_ratio": round(float(present_ratio), 4),
        "per_frame": per_frame,
        "transition_index": transition_index,
        "score": round(float(max((f["score"] for f in per_frame), default=0.0)), 4),
        "templates_used": len(templates),
    }
