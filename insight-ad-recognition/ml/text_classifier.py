"""Semantic OCR-text classifier (the "BERT chico" stage).

Runs the OCR text blob through a multilingual zero-shot NLI model (XNLI/mDeBERTa) with multi-label
scoring against advertising-intent labels. Because the model is cross-lingual, it works on Hebrew /
Spanish / English on-screen text. The fusion layer treats the co-occurrence of contact + CTA +
brand (or price) as strong ad evidence.

Returns per-label scores plus the dominant label so the fusion layer can build its ad score.
"""

import os
import threading

from transformers import pipeline

# Candidate hypotheses mapped back to canonical semantic labels. Kept in English: XNLI models
# generalize entailment across languages, so English hypotheses classify non-English premises.
_LABELS = {
    "a call to action telling the viewer to buy, call or visit now": "cta",
    "a price, discount, percentage or installment offer": "price",
    "a brand name or product name": "brand",
    "legal fine print or terms and conditions": "legal",
    "a phone number, short code or website contact": "contact",
    "normal television program content": "program",
}

_HYPOTHESIS_TEMPLATE = os.environ.get("TEXT_HYPOTHESIS_TEMPLATE", "This text is {}.")


class TextCommercialClassifier:
    def __init__(self, model_id: str):
        self.model_id = model_id
        self._lock = threading.Lock()
        self.pipe = pipeline("zero-shot-classification", model=model_id, device=-1)
        self.candidate_labels = list(_LABELS.keys())

    def classify(self, text: str) -> dict:
        text = (text or "").strip()
        if not text:
            return {"category": "unknown", "score": 0.0, "labels": {}}

        # Cap input length to keep latency bounded.
        snippet = text[:1000]
        with self._lock:
            out = self.pipe(
                snippet,
                candidate_labels=self.candidate_labels,
                hypothesis_template=_HYPOTHESIS_TEMPLATE,
                # multi_label: each intent scored independently (contact AND cta AND brand can all fire).
                multi_label=True,
            )

        # Map hypothesis -> canonical label with its score.
        labels = {}
        for hyp, sc in zip(out["labels"], out["scores"]):
            canonical = _LABELS.get(hyp)
            if canonical:
                labels[canonical] = round(float(sc), 4)

        # Dominant non-program label (for logging/observability).
        ad_labels = {k: v for k, v in labels.items() if k != "program"}
        top_label, top_score = ("unknown", 0.0)
        if ad_labels:
            top_label = max(ad_labels, key=lambda k: ad_labels[k])
            top_score = ad_labels[top_label]

        return {"category": top_label, "score": round(float(top_score), 4), "labels": labels}
