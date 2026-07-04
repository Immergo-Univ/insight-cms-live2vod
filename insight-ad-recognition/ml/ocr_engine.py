"""OCR stage using RapidOCR (PaddleOCR PP-OCR models on onnxruntime).

Extracts text + boxes from each frame, aggregates them and derives the `ocr_*` profile fields
and the ticker / lower-third / logo layout flags.
"""

import threading

from PIL import Image

from ocr_heuristics import analyze_text, layout_flags


class OcrEngine:
    def __init__(self):
        self._lock = threading.Lock()
        # Import here so the (optional) dependency only loads when the sidecar starts.
        from rapidocr_onnxruntime import RapidOCR

        self.engine = RapidOCR()

    def _run_frame(self, path: str):
        """Return (list_of_boxes, list_of_words, img_w, img_h)."""
        try:
            with Image.open(path) as im:
                img_w, img_h = im.size
        except Exception:
            img_w, img_h = 0, 0

        try:
            result, _elapse = self.engine(path)
        except Exception:
            result = None

        boxes = []
        words = []
        text_area = 0.0
        if result:
            for item in result:
                # item = [box(4 points), text, score]
                box, text, _score = item[0], item[1], item[2]
                xs = [pt[0] for pt in box]
                ys = [pt[1] for pt in box]
                x0, x1 = min(xs), max(xs)
                y0, y1 = min(ys), max(ys)
                boxes.append({"x0": x0, "y0": y0, "x1": x1, "y1": y1})
                text_area += max(0.0, (x1 - x0)) * max(0.0, (y1 - y0))
                if text:
                    words.extend(str(text).split())

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
