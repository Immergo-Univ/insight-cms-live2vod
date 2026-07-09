"""SigLIP zero-shot image classification over the fixed visual category list.

Loads the model once and scores each frame against the category prompts, then averages the
per-frame probability vectors to produce a single dominant category for the analyzed window.

Categories are business-oriented (programa / publicidad / placa / noticia / deporte /
institucional) so the fusion layer can weigh "publicidad" and "placa" as ad evidence.
"""

import os
import threading

import torch
from PIL import Image
from transformers import AutoModel, AutoProcessor

# English prompt templates per Spanish category. SigLIP was trained on English captions, so we map
# each business category to a natural-language English prompt; the Spanish key is what we report.
DEFAULT_CATEGORY_PROMPTS = {
    "programa": "a television program",
    "publicidad": "a television commercial or advertisement",
    "placa": "a full-screen graphic title card or promo slate",
    "noticia": "a television news broadcast",
    "deporte": "a live sports broadcast",
    "institucional": "a channel ident, logo bumper or institutional promo",
}


class SiglipClassifier:
    def __init__(self, model_id: str, category_prompts: dict[str, str] | None = None):
        self.model_id = model_id
        prompts = category_prompts or DEFAULT_CATEGORY_PROMPTS
        self.categories = list(prompts.keys())
        self.prompts = [f"a photo of {prompts[c]}" for c in self.categories]
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
