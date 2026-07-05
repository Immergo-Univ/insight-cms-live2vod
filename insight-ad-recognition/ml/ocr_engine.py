"""OCR stage using Tesseract (via pytesseract).

Tesseract is used instead of a single-script engine because the channels are multilingual
(English + Hebrew + Spanish). Tesseract combines scripts in one pass with `-l eng+heb+spa`
(configurable via OCR_LANGUAGES) and returns per-word boxes, which we reuse for the
ticker / lower-third / logo layout heuristics.

Extracts text + boxes from each frame, aggregates them and derives the `ocr_*` profile fields
and the layout flags.
"""

import os
import threading

from PIL import Image

from ocr_heuristics import analyze_text, layout_flags


class OcrEngine:
    def __init__(self):
        self._lock = threading.Lock()
        # e.g. "eng+heb+spa" — must match installed Tesseract traineddata (tesseract-ocr-<lang>).
        self.languages = (os.environ.get("OCR_LANGUAGES", "eng+heb+spa") or "eng").strip()
        # Discard low-confidence detections to reduce OCR noise on video frames.
        try:
            self.min_conf = float(os.environ.get("OCR_MIN_CONFIDENCE", "40"))
        except ValueError:
            self.min_conf = 40.0
        # Import here so the (optional) dependency only loads when the sidecar starts.
        import pytesseract

        self._pytesseract = pytesseract

    def _run_frame(self, path: str):
        """Return (list_of_boxes, list_of_words, img_w, img_h, density)."""
        try:
            with Image.open(path) as im:
                img = im.convert("RGB")
                img_w, img_h = img.size
                data = self._pytesseract.image_to_data(
                    img,
                    lang=self.languages,
                    output_type=self._pytesseract.Output.DICT,
                )
        except Exception:
            return [], [], 0, 0, 0.0

        boxes = []
        words = []
        text_area = 0.0

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

            x0 = float(data["left"][i])
            y0 = float(data["top"][i])
            w = float(data["width"][i])
            h = float(data["height"][i])
            x1 = x0 + w
            y1 = y0 + h

            boxes.append({"x0": x0, "y0": y0, "x1": x1, "y1": y1})
            text_area += max(0.0, w) * max(0.0, h)
            words.extend(text.split())

        density = 0.0
        if img_w > 0 and img_h > 0:
            density = min(1.0, text_area / float(img_w * img_h))

        return boxes, words, img_w, img_h, density

    def analyze_frames(self, frame_paths: list[str]) -> dict:
        all_words = []
        boxes_per_frame = []
        densities = []
        img_w = img_h = 0

        with self._lock:
            for p in frame_paths:
                boxes, words, w, h, density = self._run_frame(p)
                boxes_per_frame.append(boxes)
                all_words.extend(words)
                densities.append(density)
                if w and h:
                    img_w, img_h = w, h

        joined = " ".join(all_words)
        cues = analyze_text(joined)
        flags = layout_flags(boxes_per_frame, img_w, img_h)

        n = max(1, len(frame_paths))
        avg_density = sum(densities) / n
        # Average words visible per frame (stable regardless of frame count).
        avg_words = round(len(all_words) / n)

        ocr = dict(cues)
        ocr["ocr_text_density"] = round(float(avg_density), 4)
        ocr["ocr_word_count"] = int(avg_words)
        # Raw text recognized across the window (capped to keep the payload bounded).
        ocr["ocr_text"] = joined[:2000]

        return {"ocr": ocr, "layout": flags}
