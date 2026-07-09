"""Build-time / first-boot model prefetch so inference doesn't pay the download cost mid-request.

Downloads and caches (into $HF_HOME):
  - SigLIP model + processor (visual zero-shot classifier)
  - mDeBERTa zero-shot text classifier (semantic OCR-text intent)

Usage:
  python prefetch.py            # fetch both
  python prefetch.py siglip     # fetch only SigLIP
  python prefetch.py text       # fetch only the text classifier

The Dockerfile can call this once per model so each download lands in its own image layer (keeps
kaniko snapshots small). OCR uses Tesseract (system package) and overlay detection is pure OpenCV,
so neither needs a prefetch here. The CLAP audio classifier was removed from the stack.
"""

import os
import sys


def fetch_siglip():
    siglip_id = os.environ.get("SIGLIP_MODEL", "google/siglip-base-patch16-224")
    print(f"[prefetch] SigLIP: {siglip_id}", flush=True)
    from transformers import AutoModel, AutoProcessor

    AutoProcessor.from_pretrained(siglip_id)
    AutoModel.from_pretrained(siglip_id)


def fetch_text():
    text_id = os.environ.get("TEXT_MODEL", "MoritzLaurer/mDeBERTa-v3-base-mnli-xnli")
    print(f"[prefetch] text classifier: {text_id}", flush=True)
    from transformers import pipeline

    pipeline("zero-shot-classification", model=text_id, device=-1)


_TARGETS = {"siglip": fetch_siglip, "text": fetch_text}


def main():
    which = sys.argv[1].lower() if len(sys.argv) > 1 else "all"
    if which == "all":
        fetch_siglip()
        fetch_text()
    elif which in _TARGETS:
        _TARGETS[which]()
    else:
        print(f"[prefetch] unknown target '{which}' (use: siglip|text|all)", flush=True)
        sys.exit(2)
    print("[prefetch] done", flush=True)


if __name__ == "__main__":
    main()
