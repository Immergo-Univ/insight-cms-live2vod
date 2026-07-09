"""SigLIP zero-shot image classification over the fixed visual category list.

Loads the model once and scores each frame against the category prompts, then averages across the
analyzed frames to produce a single dominant category for the window.

Two reinforcements over a naive single-prompt sigmoid classifier (which produced near-zero,
unusable scores in practice):

  1. PROMPT ENSEMBLING — each business category (programa / publicidad / placa / noticia / deporte /
     institucional) is described by SEVERAL natural-language English prompts. We average the raw
     logits of a category's prompts, which is far more robust than a single wording.

  2. SOFTMAX (relative) SCORE — SigLIP's sigmoid head yields tiny absolute probabilities for every
     category on broadcast frames, so the old `video_category_score_avg` was ~0 and contributed
     nothing to the fusion. We instead softmax the per-category logits to get a proper relative
     distribution (sums to 1); the dominant category then carries a meaningful 0..1 score. The raw
     sigmoid of the winner is still returned as `video_category_sigmoid` for reference.
"""

import math
import os
import threading

import torch
from PIL import Image
from transformers import AutoModel, AutoProcessor

# English prompt ENSEMBLES per Spanish category. SigLIP was trained on English captions; the Spanish
# key is what we report. More/discriminative prompts => better zero-shot separation.
DEFAULT_CATEGORY_PROMPTS = {
    "programa": [
        "a television program",
        "a tv studio show with a host",
        "a talk show set with people talking",
        "an entertainment television show",
    ],
    "publicidad": [
        "a television commercial",
        "an advertisement for a product",
        "a product close-up with a price on screen",
        "an infomercial demonstrating a product",
        "a retail store sale advertisement",
        "a car or furniture commercial",
    ],
    "placa": [
        "a full-screen graphic title card",
        "a full screen promo slate with big text",
        "a sponsor graphic card",
        "a text-only promotional screen",
    ],
    "noticia": [
        "a television news broadcast",
        "a news anchor at a desk",
        "a breaking news screen with a lower-third ticker",
        "a news report from the field",
    ],
    "deporte": [
        "a live sports broadcast",
        "athletes playing on a field or court",
        "a sports match with a scoreboard",
        "a stadium full of spectators",
    ],
    "institucional": [
        "a tv channel logo bumper",
        "a television station ident",
        "an institutional or public-service promo",
        "a channel branding animation",
    ],
}


def _normalize_prompts(category_prompts):
    """Accept either {cat: str} or {cat: [str, ...]} and return {cat: [str, ...]}."""
    out = {}
    for cat, val in category_prompts.items():
        if isinstance(val, str):
            out[cat] = [val]
        elif isinstance(val, (list, tuple)) and val:
            out[cat] = [str(x) for x in val]
        else:
            out[cat] = [str(cat)]
    return out


class SiglipClassifier:
    def __init__(self, model_id: str, category_prompts=None):
        self.model_id = model_id
        prompts = _normalize_prompts(category_prompts or DEFAULT_CATEGORY_PROMPTS)
        self.categories = list(prompts.keys())

        # Flatten all prompts, remembering which category each belongs to (for ensembling).
        self.flat_prompts = []
        self.group_index = []  # parallel to flat_prompts: category index
        for ci, cat in enumerate(self.categories):
            for prompt in prompts[cat]:
                self.flat_prompts.append(f"a photo of {prompt}")
                self.group_index.append(ci)

        self._lock = threading.Lock()
        self.device = "cpu"
        torch.set_num_threads(max(1, os.cpu_count() or 1))
        self.processor = AutoProcessor.from_pretrained(model_id)
        self.model = AutoModel.from_pretrained(model_id).to(self.device).eval()

    @torch.inference_mode()
    def _logits_per_category(self, image: Image.Image) -> list[float]:
        """Return per-category logits for one image (ensemble-averaged over each category's prompts)."""
        inputs = self.processor(
            text=self.flat_prompts,
            images=image,
            padding="max_length",
            return_tensors="pt",
        ).to(self.device)
        outputs = self.model(**inputs)
        # SigLIP logits_per_image: [1, num_prompts].
        logits = outputs.logits_per_image[0].cpu().tolist()

        n_cat = len(self.categories)
        sums = [0.0] * n_cat
        counts = [0] * n_cat
        for prompt_idx, ci in enumerate(self.group_index):
            sums[ci] += logits[prompt_idx]
            counts[ci] += 1
        return [sums[i] / counts[i] if counts[i] else 0.0 for i in range(n_cat)]

    def classify_frames(self, frame_paths: list[str]) -> dict:
        """Return the averaged category distribution (softmax) and the dominant category."""
        n_cat = len(self.categories)
        acc_logits = [0.0] * n_cat
        used = 0

        with self._lock:
            for p in frame_paths:
                try:
                    with Image.open(p) as im:
                        img = im.convert("RGB")
                    logits = self._logits_per_category(img)
                except Exception:
                    continue
                for i in range(n_cat):
                    acc_logits[i] += logits[i]
                used += 1

        if used == 0:
            return {
                "video_category_avg": "unknown",
                "video_category_score_avg": 0.0,
                "video_category_sigmoid": 0.0,
                "per_category": {},
            }

        avg_logits = [a / used for a in acc_logits]

        # Softmax over categories -> relative distribution (usable, sums to 1).
        m = max(avg_logits)
        exps = [math.exp(x - m) for x in avg_logits]
        z = sum(exps) or 1.0
        soft = [e / z for e in exps]

        best_idx = max(range(n_cat), key=lambda i: soft[i])
        sigmoid_best = 1.0 / (1.0 + math.exp(-avg_logits[best_idx]))

        return {
            "video_category_avg": self.categories[best_idx],
            # Relative confidence of the dominant category (0..1) — this is what the fusion uses.
            "video_category_score_avg": round(float(soft[best_idx]), 4),
            # Raw sigmoid of the winning category's logit, for reference/debugging.
            "video_category_sigmoid": round(float(sigmoid_best), 4),
            "per_category": {self.categories[i]: round(float(soft[i]), 4) for i in range(n_cat)},
        }
