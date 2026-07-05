"""Build-time model prefetch so the runtime image is fully self-contained (no network at boot).

Downloads and caches:
  - SigLIP model + processor
  - Zero-shot text classifier

(OCR uses Tesseract, whose language data is installed as system packages in the Dockerfile, so it
needs no prefetch here.)
"""

import os


def main():
    siglip_id = os.environ.get("SIGLIP_MODEL", "google/siglip-base-patch16-224")
    text_id = os.environ.get("TEXT_MODEL", "MoritzLaurer/mDeBERTa-v3-base-mnli-xnli")

    print(f"[prefetch] SigLIP: {siglip_id}", flush=True)
    from transformers import AutoModel, AutoProcessor

    AutoProcessor.from_pretrained(siglip_id)
    AutoModel.from_pretrained(siglip_id)

    print(f"[prefetch] text classifier: {text_id}", flush=True)
    from transformers import pipeline

    pipeline("zero-shot-classification", model=text_id, device=-1)

    print("[prefetch] done", flush=True)


if __name__ == "__main__":
    main()
