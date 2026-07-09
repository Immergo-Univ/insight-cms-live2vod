"""OCR text translation to English using NLLB-200 (Meta).

The OCR text is multilingual (mostly Hebrew, some Spanish/English). We translate everything to
English so the admin can read the scan summary and write English OCR rules. Source language is
guessed from the script:
  - any Hebrew codepoint            -> heb_Hebr
  - accented Latin (Spanish marks)  -> spa_Latn
  - otherwise (plain ASCII/English) -> returned as-is (no translation needed)

Model default: facebook/nllb-200-distilled-600M (CPU friendly). Loads lazily on first use.
"""

import os
import re
import threading

_HEBREW_RE = re.compile(r"[\u0590-\u05FF]")
_SPANISH_RE = re.compile(r"[áéíóúüñ¿¡ÁÉÍÓÚÜÑ]")
_TGT_LANG = "eng_Latn"


class Translator:
    def __init__(self, model_id: str | None = None):
        self.model_id = model_id or os.environ.get("NLLB_MODEL", "facebook/nllb-200-distilled-600M")
        self._lock = threading.Lock()
        self._tokenizer = None
        self._model = None
        self._tgt_id = None

    def load(self):
        """Preload tokenizer + model so the first real request doesn't pay the init cost."""
        with self._lock:
            if self._model is not None:
                return
            import torch  # noqa: F401  (ensures the CPU backend is importable)
            from transformers import AutoModelForSeq2SeqLM, AutoTokenizer

            tokenizer = AutoTokenizer.from_pretrained(self.model_id)
            model = AutoModelForSeq2SeqLM.from_pretrained(self.model_id)
            model.eval()
            self._tokenizer = tokenizer
            self._model = model
            self._tgt_id = tokenizer.convert_tokens_to_ids(_TGT_LANG)

    @staticmethod
    def _guess_src(text: str) -> str | None:
        if _HEBREW_RE.search(text):
            return "heb_Hebr"
        if _SPANISH_RE.search(text):
            return "spa_Latn"
        return None  # plain latin/english -> skip translation

    def translate(self, text: str) -> str:
        text = (text or "").strip()
        if not text:
            return ""
        src = self._guess_src(text)
        if src is None:
            # Already English (or plain latin) — nothing to translate.
            return text

        self.load()
        import torch

        with self._lock:
            self._tokenizer.src_lang = src
            inputs = self._tokenizer(
                text,
                return_tensors="pt",
                truncation=True,
                max_length=512,
            )
            with torch.no_grad():
                generated = self._model.generate(
                    **inputs,
                    forced_bos_token_id=self._tgt_id,
                    max_length=512,
                    num_beams=1,
                )
            out = self._tokenizer.batch_decode(generated, skip_special_tokens=True)
        return (out[0] if out else "").strip()
