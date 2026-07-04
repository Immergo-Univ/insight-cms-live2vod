"""Transcript commercial classifier (the "BERT" text stage).

Uses a small NLI model as a zero-shot classifier to decide whether the English transcript of the
audio sounds like a TV commercial or normal programming. Runs entirely on CPU, model loaded once.
"""

import threading

from transformers import pipeline

# Candidate hypotheses mapped back to canonical categories.
_LABELS = {
    "a television commercial or advertisement": "TV Commercial",
    "a normal television program": "program",
}


class TextCommercialClassifier:
    def __init__(self, model_id: str):
        self.model_id = model_id
        self._lock = threading.Lock()
        self.pipe = pipeline("zero-shot-classification", model=model_id, device=-1)
        self.candidate_labels = list(_LABELS.keys())

    def classify(self, text: str) -> dict:
        text = (text or "").strip()
        if not text:
            return {"category": "unknown", "score": 0.0}

        # Cap input length to keep latency bounded.
        snippet = text[:1000]
        with self._lock:
            out = self.pipe(snippet, candidate_labels=self.candidate_labels, multi_label=False)

        top_label = out["labels"][0]
        top_score = float(out["scores"][0])
        return {"category": _LABELS.get(top_label, "unknown"), "score": round(top_score, 4)}
