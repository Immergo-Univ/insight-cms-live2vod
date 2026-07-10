"""Optional Template Matching detection method (OpenCV cv2.matchTemplate).

Alternative to pHash for the logo appearance/disappearance strategies. Given a frame ROI crop and
one or more template images (the uploaded samples, by public URL), it returns the best normalized
cross-correlation score (0..1) over several scales, sliding the template inside the ROI.

Downloaded/decoded templates are cached in-memory by URL so repeated probes don't re-fetch them.
"""

import threading
import urllib.request

import numpy as np
from PIL import Image

_LOCK = threading.Lock()
_CACHE: dict[str, "np.ndarray"] = {}
_SCALES = (1.0, 0.85, 0.7, 0.55, 0.4)


def _pil_to_gray(img: Image.Image) -> "np.ndarray":
    return np.asarray(img.convert("L"), dtype=np.uint8)


def _crop_roi(img: Image.Image, roi: dict | None) -> Image.Image:
    if not roi:
        return img
    w_img, h_img = img.size
    try:
        x = float(roi.get("x", 0.0))
        y = float(roi.get("y", 0.0))
        w = float(roi.get("w", 1.0))
        h = float(roi.get("h", 1.0))
    except (TypeError, ValueError):
        return img
    left = max(0, min(w_img, int(round(x * w_img))))
    top = max(0, min(h_img, int(round(y * h_img))))
    right = max(left + 1, min(w_img, int(round((x + w) * w_img))))
    bottom = max(top + 1, min(h_img, int(round((y + h) * h_img))))
    if right - left < 2 or bottom - top < 2:
        return img
    return img.crop((left, top, right, bottom))


def _load_template_gray(url: str) -> "np.ndarray | None":
    with _LOCK:
        cached = _CACHE.get(url)
    if cached is not None:
        return cached
    try:
        req = urllib.request.Request(url, headers={"User-Agent": "insight-ad-recognition/1.0"})
        with urllib.request.urlopen(req, timeout=8) as resp:  # noqa: S310 - trusted admin URLs
            data = resp.read()
        import io

        gray = _pil_to_gray(Image.open(io.BytesIO(data)))
        with _LOCK:
            _CACHE[url] = gray
        return gray
    except Exception as e:  # noqa: BLE001
        print(f"[ml] template fetch failed ({url}): {e}", flush=True)
        return None


def match_roi(frame_path: str, roi: dict | None, template_urls: list[str]) -> float:
    """Best normalized cross-correlation (0..1) of any template inside the ROI crop."""
    import cv2  # lazy import (only when Template Matching is used)

    if not template_urls:
        return 0.0
    try:
        with Image.open(frame_path) as im:
            crop = _pil_to_gray(_crop_roi(im.convert("RGB"), roi))
    except Exception:
        return 0.0

    ch, cw = crop.shape[:2]
    if ch < 8 or cw < 8:
        return 0.0

    best = 0.0
    for url in template_urls:
        tpl = _load_template_gray(url)
        if tpl is None or tpl.size == 0:
            continue
        for scale in _SCALES:
            th = int(tpl.shape[0] * scale)
            tw = int(tpl.shape[1] * scale)
            if th < 8 or tw < 8:
                continue
            t = cv2.resize(tpl, (tw, th))
            # If the (scaled) template is larger than the crop, shrink it to fit.
            if th > ch or tw > cw:
                fit = min(ch / th, cw / tw)
                tw = max(1, int(tw * fit))
                th = max(1, int(th * fit))
                if th < 8 or tw < 8 or th > ch or tw > cw:
                    continue
                t = cv2.resize(t, (tw, th))
            res = cv2.matchTemplate(crop, t, cv2.TM_CCOEFF_NORMED)
            _, mx, _, _ = cv2.minMaxLoc(res)
            if mx > best:
                best = float(mx)
    return max(0.0, min(1.0, best))
