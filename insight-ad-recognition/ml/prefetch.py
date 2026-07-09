"""Build-time model prefetch so the runtime image is fully self-contained (no network at boot).

Downloads and caches (into $HF_HOME):
  - SigLIP model + processor (visual zero-shot classifier)
  - mDeBERTa zero-shot text classifier (semantic OCR-text intent)
  - CLAP model + processor (audio zero-shot classifier)

Usage:
  python prefetch.py            # fetch all three
  python prefetch.py siglip     # fetch only SigLIP
  python prefetch.py text       # fetch only the text classifier
  python prefetch.py clap       # fetch only CLAP

The Dockerfile calls this once per model so each download lands in its OWN image layer. That keeps
each kaniko snapshot small enough to fit the constrained build machine (one ~1.5 GB combined layer
was OOM-ing the DigitalOcean builder during "Taking snapshot of files...").

OCR uses Tesseract (system package) and overlay detection is pure OpenCV, so neither needs a
prefetch here.
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


def fetch_clap():
    clap_id = os.environ.get("CLAP_MODEL", "laion/clap-htsat-unfused")
    print(f"[prefetch] CLAP: {clap_id}", flush=True)
    from transformers import ClapModel, ClapProcessor

    ClapProcessor.from_pretrained(clap_id)
    ClapModel.from_pretrained(clap_id)


_TARGETS = {"siglip": fetch_siglip, "text": fetch_text, "clap": fetch_clap}


def main():
    which = sys.argv[1].lower() if len(sys.argv) > 1 else "all"
    if which == "all":
        fetch_siglip()
        fetch_text()
        fetch_clap()
    elif which in _TARGETS:
        _TARGETS[which]()
    else:
        print(f"[prefetch] unknown target '{which}' (use: siglip|text|clap|all)", flush=True)
        sys.exit(2)
    print("[prefetch] done", flush=True)


if __name__ == "__main__":
    main()
