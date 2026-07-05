"""Transcript commercial classifier (the "BERT" text stage).

Uses a multilingual NLI model (XNLI) as a zero-shot classifier to decide whether the transcript of
the audio sounds like a TV commercial or normal programming. Because the model is cross-lingual, it
works on Hebrew / Spanish / English transcripts (Whisper auto-detects the spoken language). Runs
entirely on CPU, model loaded once.
"""

import os
import threading

from transformers import pipeline

# Candidate hypotheses mapped back to canonical categories. Kept in English: XNLI models generalize
# the entailment across languages, so English hypotheses classify non-English premises correctly.
_LABELS = {
    "a television commercial or advertisement": "TV Commercial",
    "a normal television program": "program",
}

# XNLI models expect a hypothesis template; the pipeline fills {} with each candidate label.
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
            return {"category": "unknown", "score": 0.0}

        # Cap input length to keep latency bounded.
        snippet = text[:1000]
        with self._lock:
            out = self.pipe(
                snippet,
                candidate_labels=self.candidate_labels,
                hypothesis_template=_HYPOTHESIS_TEMPLATE,
                multi_label=False,
            )

        top_label = out["labels"][0]
        top_score = float(out["scores"][0])
        return {"category": _LABELS.get(top_label, "unknown"), "score": round(top_score, 4)}
