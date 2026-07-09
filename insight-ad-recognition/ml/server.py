"""In-container ML sidecar for insight-ad-recognition (multimodal).

FastAPI server that preloads the CPU model battery and exposes:
  GET  /health          -> { ready, error, models }
  POST /vision {frames}  -> SigLIP category avg + OCR text/cues geometry + overlay flags
  POST /text   {text}    -> semantic ad-intent labels (mDeBERTa zero-shot)
  POST /audio  {path}    -> CLAP zero-shot audio categories, chunked

The Node process starts this as a child and talks to it over localhost. Models load once so
per-request inference is fast; each model call is guarded by its own lock for concurrent safety.
"""

import json
import os

from fastapi import FastAPI
from fastapi.concurrency import run_in_threadpool
from pydantic import BaseModel

# CLAP content categories (kept in sync with src/config.js audioCategories).
DEFAULT_AUDIO_CATEGORIES = [
    "Television commercial",
    "Advertisement",
    "News broadcast",
    "Sports broadcast",
    "Movie",
    "TV series",
    "Talk show",
    "Interview",
    "Music performance",
    "Weather forecast",
    "Children's program",
]


def _audio_categories() -> list[str]:
    raw = os.environ.get("AUDIO_CATEGORIES")
    if raw:
        try:
            parsed = json.loads(raw)
            if isinstance(parsed, list) and parsed:
                return [str(x) for x in parsed]
        except Exception:
            pass
    return DEFAULT_AUDIO_CATEGORIES


def _visual_category_prompts() -> dict | None:
    """Optional override for the SigLIP category->prompt map (JSON object). Falls back to the
    module default (programa/publicidad/placa/noticia/deporte/institucional)."""
    raw = os.environ.get("VISUAL_CATEGORY_PROMPTS")
    if raw:
        try:
            parsed = json.loads(raw)
            if isinstance(parsed, dict) and parsed:
                return {str(k): str(v) for k, v in parsed.items()}
        except Exception:
            pass
    return None


app = FastAPI(title="insight-ad-recognition ML sidecar")

STATE = {
    "ready": False,
    "siglip": None,
    "ocr": None,
    "overlay": None,
    "text": None,
    "clap": None,
    "error": None,
}


class VisionRequest(BaseModel):
    frames: list[str]


class TextRequest(BaseModel):
    text: str = ""


class AudioRequest(BaseModel):
    path: str
    chunkSeconds: float | None = None


def _warmup():
    """Run one dummy inference per model so the FIRST real request doesn't pay the lazy graph-init
    cost. Never blocks readiness — if warmup fails, the sidecar still serves."""
    import math
    import struct
    import tempfile
    import wave

    from PIL import Image

    from audio_clap import TARGET_SR

    img_path = None
    wav_path = None
    try:
        with tempfile.NamedTemporaryFile(suffix=".jpg", delete=False) as tf:
            img_path = tf.name
        Image.new("RGB", (224, 224), (16, 16, 16)).save(img_path, "JPEG")
        if STATE["siglip"]:
            STATE["siglip"].classify_frames([img_path])
        if STATE["ocr"]:
            STATE["ocr"].analyze_frames([img_path])
        if STATE["overlay"]:
            STATE["overlay"].analyze_frames([img_path], [[]])
        if STATE["text"]:
            STATE["text"].classify("warmup")

        with tempfile.NamedTemporaryFile(suffix=".wav", delete=False) as tf:
            wav_path = tf.name
        n = TARGET_SR
        samples = bytearray()
        for i in range(n):
            v = int(0.1 * 32767 * math.sin(2 * math.pi * 440 * i / TARGET_SR))
            samples += struct.pack("<h", v)
        with wave.open(wav_path, "wb") as w:
            w.setnchannels(1)
            w.setsampwidth(2)
            w.setframerate(TARGET_SR)
            w.writeframes(bytes(samples))
        if STATE["clap"]:
            STATE["clap"].classify(wav_path, chunk_seconds=1.0)
        print("[ml] warmup inference done", flush=True)
    except Exception as e:  # noqa: BLE001 - warmup must never prevent the sidecar from serving
        print(f"[ml] warmup skipped: {e}", flush=True)
    finally:
        for p in (img_path, wav_path):
            if p:
                try:
                    os.remove(p)
                except OSError:
                    pass


@app.on_event("startup")
def _load_models():
    try:
        from vision_siglip import SiglipClassifier
        from ocr_engine import OcrEngine
        from overlay_detect import OverlayDetector
        from text_classifier import TextCommercialClassifier
        from audio_clap import AudioClapClassifier

        siglip_id = os.environ.get("SIGLIP_MODEL", "google/siglip-base-patch16-224")
        text_id = os.environ.get("TEXT_MODEL", "MoritzLaurer/mDeBERTa-v3-base-mnli-xnli")
        clap_id = os.environ.get("CLAP_MODEL", "laion/clap-htsat-unfused")

        STATE["siglip"] = SiglipClassifier(siglip_id, _visual_category_prompts())
        STATE["ocr"] = OcrEngine()
        STATE["overlay"] = OverlayDetector()
        STATE["text"] = TextCommercialClassifier(text_id)
        STATE["clap"] = AudioClapClassifier(clap_id, _audio_categories())
        _warmup()
        STATE["ready"] = True
        print("[ml] all models loaded, sidecar ready", flush=True)
    except Exception as e:  # noqa: BLE001 - report and stay up in a not-ready state
        STATE["error"] = str(e)
        print(f"[ml] model load failed: {e}", flush=True)


@app.get("/health")
def health():
    return {
        "ready": bool(STATE["ready"]),
        "error": STATE["error"],
        "models": {
            "siglip": STATE["siglip"] is not None,
            "ocr": STATE["ocr"] is not None,
            "overlay": STATE["overlay"] is not None,
            "text": STATE["text"] is not None,
            "clap": STATE["clap"] is not None,
        },
    }


@app.post("/vision")
async def vision(req: VisionRequest):
    if not STATE["ready"]:
        return {"error": "models not ready"}

    frames = req.frames or []

    def _work():
        vis = STATE["siglip"].classify_frames(frames)
        ocr_out = STATE["ocr"].analyze_frames(frames)
        overlay = STATE["overlay"].analyze_frames(frames, ocr_out.get("boxes_per_frame"))
        return {
            "video_category_avg": vis["video_category_avg"],
            "video_category_score_avg": vis["video_category_score_avg"],
            "per_category": vis["per_category"],
            "ocr_text": ocr_out["text"],
            "ocr_text_density": ocr_out["text_density"],
            "ocr_word_count": ocr_out["word_count"],
            "overlay": overlay,
        }

    return await run_in_threadpool(_work)


@app.post("/text")
async def text(req: TextRequest):
    if not STATE["ready"]:
        return {"category": "unknown", "score": 0.0, "labels": {}}
    return await run_in_threadpool(STATE["text"].classify, req.text)


@app.post("/audio")
async def audio(req: AudioRequest):
    if not STATE["ready"]:
        return {"error": "models not ready"}

    chunk_seconds = req.chunkSeconds if req.chunkSeconds and req.chunkSeconds > 0 else 5.0

    def _work():
        return STATE["clap"].classify(req.path, chunk_seconds=chunk_seconds)

    return await run_in_threadpool(_work)


def main():
    import uvicorn

    host = os.environ.get("ML_SIDECAR_HOST", "127.0.0.1")
    port = int(os.environ.get("ML_SIDECAR_PORT", "8100"))
    uvicorn.run(app, host=host, port=port, log_level="warning")


if __name__ == "__main__":
    main()
