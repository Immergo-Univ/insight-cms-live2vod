"""Build-time model prefetch so the runtime image is fully self-contained (no network at boot).

Downloads and caches the CLAP model + processor into $HF_HOME. Since v2 the microservice runs
audio-only (SigLIP / OCR / whisper-text-classifier were removed), so this is the only model that
needs prefetching. Whisper.cpp is fetched separately in the Dockerfile.
"""

import os


def main():
    clap_id = os.environ.get("CLAP_MODEL", "laion/clap-htsat-unfused")

    print(f"[prefetch] CLAP: {clap_id}", flush=True)
    from transformers import ClapModel, ClapProcessor

    ClapProcessor.from_pretrained(clap_id)
    ClapModel.from_pretrained(clap_id)

    print("[prefetch] done", flush=True)


if __name__ == "__main__":
    main()
