"""Build-time model prefetch so the runtime image is fully self-contained (no network at boot).

Downloads and caches:
  - SigLIP model + processor (visual zero-shot classifier)
  - mDeBERTa zero-shot text classifier (semantic OCR-text intent)
  - CLAP model + processor (audio zero-shot classifier)

OCR uses Tesseract, whose language data is installed as system packages in the Dockerfile, so it
needs no prefetch here. Overlay detection is pure OpenCV (no model).
"""

import os


def main():
    siglip_id = os.environ.get("SIGLIP_MODEL", "google/siglip-base-patch16-224")
    text_id = os.environ.get("TEXT_MODEL", "MoritzLaurer/mDeBERTa-v3-base-mnli-xnli")
    clap_id = os.environ.get("CLAP_MODEL", "laion/clap-htsat-unfused")

    print(f"[prefetch] SigLIP: {siglip_id}", flush=True)
    from transformers import AutoModel, AutoProcessor

    AutoProcessor.from_pretrained(siglip_id)
    AutoModel.from_pretrained(siglip_id)

    print(f"[prefetch] text classifier: {text_id}", flush=True)
    from transformers import pipeline

    pipeline("zero-shot-classification", model=text_id, device=-1)

    print(f"[prefetch] CLAP: {clap_id}", flush=True)
    from transformers import ClapModel, ClapProcessor

    ClapProcessor.from_pretrained(clap_id)
    ClapModel.from_pretrained(clap_id)

    print("[prefetch] done", flush=True)


if __name__ == "__main__":
    main()
