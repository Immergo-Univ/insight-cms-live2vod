"""SigLIP zero-shot image classification over the fixed category list.

Loads the model once and scores each frame against the category prompts, then averages the
per-frame probability vectors to produce a single dominant category for the window.
"""

import os
import threading

import torch
from PIL import Image
from transformers import AutoModel, AutoProcessor


class SiglipClassifier:
    def __init__(self, model_id: str, categories: list[str]):
        self.model_id = model_id
        self.categories = categories
        self.prompts = [f"a photo of {c.lower()}" for c in categories]
        self._lock = threading.Lock()

        self.device = "cpu"
        torch.set_num_threads(max(1, os.cpu_count() or 1))
        self.processor = AutoProcessor.from_pretrained(model_id)
        self.model = AutoModel.from_pretrained(model_id).to(self.device).eval()

    @torch.inference_mode()
    def _score_image(self, image: Image.Image):
        inputs = self.processor(
            text=self.prompts,
            images=image,
            padding="max_length",
            return_tensors="pt",
        ).to(self.device)
        outputs = self.model(**inputs)
        # SigLIP uses a sigmoid head; logits_per_image: [1, num_prompts].
        logits = outputs.logits_per_image[0]
        probs = torch.sigmoid(logits)
        return probs.cpu().tolist()

    def classify_frames(self, frame_paths: list[str]) -> dict:
        """Return the averaged category distribution and the dominant category."""
        n_cat = len(self.categories)
        acc = [0.0] * n_cat
        used = 0

        with self._lock:
            for p in frame_paths:
                try:
                    with Image.open(p) as im:
                        img = im.convert("RGB")
                    scores = self._score_image(img)
                except Exception:
                    continue
                for i in range(n_cat):
                    acc[i] += scores[i]
                used += 1

        if used == 0:
            return {
                "video_category_avg": "unknown",
                "video_category_score_avg": 0.0,
                "per_category": {},
            }

        avg = [a / used for a in acc]
        best_idx = max(range(n_cat), key=lambda i: avg[i])
        return {
            "video_category_avg": self.categories[best_idx],
            "video_category_score_avg": round(float(avg[best_idx]), 4),
            "per_category": {self.categories[i]: round(float(avg[i]), 4) for i in range(n_cat)},
        }
