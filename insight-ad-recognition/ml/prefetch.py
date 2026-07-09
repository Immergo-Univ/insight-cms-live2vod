"""Build-time / first-boot model prefetch so inference doesn't pay the download cost mid-request.

Downloads and caches (into $HF_HOME):
  - NLLB-200 translation model (OCR text -> English)

Usage:
  python prefetch.py            # fetch NLLB
  python prefetch.py nllb       # same

OCR uses Tesseract (system package) and perceptual hashing is pure Pillow/imagehash, so neither
needs a prefetch here.
"""

import os
import sys


def fetch_nllb():
    model_id = os.environ.get("NLLB_MODEL", "facebook/nllb-200-distilled-600M")
    print(f"[prefetch] NLLB: {model_id}", flush=True)
    from transformers import AutoModelForSeq2SeqLM, AutoTokenizer

    AutoTokenizer.from_pretrained(model_id)
    AutoModelForSeq2SeqLM.from_pretrained(model_id)


_TARGETS = {"nllb": fetch_nllb}


def main():
    which = sys.argv[1].lower() if len(sys.argv) > 1 else "all"
    if which in ("all", "nllb"):
        fetch_nllb()
    else:
        print(f"[prefetch] unknown target '{which}' (use: nllb|all)", flush=True)
        sys.exit(2)
    print("[prefetch] done", flush=True)


if __name__ == "__main__":
    main()
