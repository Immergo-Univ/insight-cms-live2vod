"""OCR stage using Tesseract (via pytesseract).

Channels are multilingual (Hebrew + English + Spanish), so one pass with `-l heb+eng+spa`
(configurable via OCR_LANGUAGES) is used. We expose two helpers:

  - full_text(path)          -> OCR the whole frame.
  - crop_text(path, roi)     -> OCR only a normalized ROI ({x, y, w, h} in 0..1).

Only words above OCR_MIN_CONFIDENCE are kept, to reduce noise on video frames.
"""

import os
import threading

from PIL import Image


class OcrEngine:
    def __init__(self):
        self._lock = threading.Lock()
        # e.g. "heb+eng+spa" — must match installed Tesseract traineddata (tesseract-ocr-<lang>).
        self.languages = (os.environ.get("OCR_LANGUAGES", "heb+eng+spa") or "eng").strip()
        try:
            self.min_conf = float(os.environ.get("OCR_MIN_CONFIDENCE", "40"))
        except ValueError:
            self.min_conf = 40.0
        import pytesseract

        self._pytesseract = pytesseract

    def _ocr_image(self, img: Image.Image) -> str:
        """Return the joined recognized text (words above the confidence floor)."""
        try:
            data = self._pytesseract.image_to_data(
                img,
                lang=self.languages,
                output_type=self._pytesseract.Output.DICT,
            )
        except Exception:
            return ""

        words = []
        n = len(data.get("text", []))
        for i in range(n):
            text = (data["text"][i] or "").strip()
            if not text:
                continue
            try:
                conf = float(data["conf"][i])
            except (TypeError, ValueError):
                conf = -1.0
            if conf < self.min_conf:
                continue
            words.extend(text.split())

        return " ".join(words)[:2000]

    def full_text(self, path: str) -> str:
        with self._lock:
            try:
                with Image.open(path) as im:
                    return self._ocr_image(im.convert("RGB"))
            except Exception:
                return ""

    def crop_text(self, path: str, roi: dict | None) -> str:
        with self._lock:
            try:
                with Image.open(path) as im:
                    img = im.convert("RGB")
                    cropped = _crop_roi(img, roi)
                    return self._ocr_image(cropped)
            except Exception:
                return ""


def _crop_roi(img: Image.Image, roi: dict | None) -> Image.Image:
    """Crop a normalized ROI ({x, y, w, h} in 0..1). Returns the whole image when roi is empty."""
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
