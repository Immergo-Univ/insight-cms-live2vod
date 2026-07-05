"""In-container ML sidecar for insight-ad-recognition.

FastAPI server that preloads:
  - SigLIP zero-shot image classifier (video categories)
  - Transcript commercial classifier (zero-shot text "BERT")
  - RapidOCR (PaddleOCR PP-OCR models on onnxruntime)

Exposes:
  GET  /health          -> { ready: bool }
  POST /vision {frames}  -> siglip category avg + ocr_* fields + layout flags
  POST /text   {text}    -> { category, score }

The Node process starts this as a child and talks to it over localhost. Models load once so
per-request inference is fast; each model call is guarded by its own lock for concurrent safety.
"""

import json
import os

from fastapi import FastAPI
from fastapi.concurrency import run_in_threadpool
from pydantic import BaseModel

DEFAULT_CATEGORIES = [
    "TV commercial",
    "Television program",
    "Movie",
    "News broadcast",
    "Sports broadcast",
    "Talk show",
    "Studio",
    "Animation",
    "Black screen",
    "Slate",
    "Test pattern",
    "Logo bumper",
    "Credits",
]


def _categories() -> list[str]:
    raw = os.environ.get("VISION_CATEGORIES")
    if raw:
        try:
            parsed = json.loads(raw)
            if isinstance(parsed, list) and parsed:
                return [str(x) for x in parsed]
        except Exception:
            pass
    return DEFAULT_CATEGORIES


app = FastAPI(title="insight-ad-recognition ML sidecar")

STATE = {"ready": False, "siglip": None, "text": None, "ocr": None, "error": None}


class VisionRequest(BaseModel):
    frames: list[str]


class TextRequest(BaseModel):
    text: str = ""


def _warmup():
    """Run one dummy inference per model so the FIRST real request doesn't pay the lazy graph-init
    cost (which otherwise blows past the client's /vision timeout). Never blocks readiness."""
    import tempfile

    from PIL import Image

    tmp_path = None
    try:
        with tempfile.NamedTemporaryFile(suffix=".jpg", delete=False) as tf:
            tmp_path = tf.name
        Image.new("RGB", (224, 224), (16, 16, 16)).save(tmp_path, "JPEG")
        STATE["siglip"].classify_frames([tmp_path])
        STATE["ocr"].analyze_frames([tmp_path])
        STATE["text"].classify("warmup")
        print("[ml] warmup inference done", flush=True)
    except Exception as e:  # noqa: BLE001 - warmup must never prevent the sidecar from serving
        print(f"[ml] warmup skipped: {e}", flush=True)
    finally:
        if tmp_path:
            try:
                os.remove(tmp_path)
            except OSError:
                pass


@app.on_event("startup")
def _load_models():
    try:
        from vision_siglip import SiglipClassifier
        from text_classifier import TextCommercialClassifier
        from ocr_engine import OcrEngine

        siglip_id = os.environ.get("SIGLIP_MODEL", "google/siglip-base-patch16-224")
        text_id = os.environ.get("TEXT_MODEL", "MoritzLaurer/mDeBERTa-v3-base-mnli-xnli")

        STATE["siglip"] = SiglipClassifier(siglip_id, _categories())
        STATE["text"] = TextCommercialClassifier(text_id)
        STATE["ocr"] = OcrEngine()
        # Prime the graphs before advertising readiness so the first probe is fast.
        _warmup()
        STATE["ready"] = True
        print("[ml] all models loaded, sidecar ready", flush=True)
    except Exception as e:  # noqa: BLE001 - report and stay up in a not-ready state
        STATE["error"] = str(e)
        print(f"[ml] model load failed: {e}", flush=True)


@app.get("/health")
def health():
    return {"ready": bool(STATE["ready"]), "error": STATE["error"]}


@app.post("/vision")
async def vision(req: VisionRequest):
    if not STATE["ready"]:
        return {"error": "models not ready"}

    frames = req.frames or []

    def _work():
        vis = STATE["siglip"].classify_frames(frames)
        ocr_out = STATE["ocr"].analyze_frames(frames)
        result = {
            "video_category_avg": vis["video_category_avg"],
            "video_category_score_avg": vis["video_category_score_avg"],
            "per_category": vis["per_category"],
            "ocr": ocr_out["ocr"],
        }
        result.update(ocr_out["layout"])  # ticker_present, lower_third_present, channel_logo_present
        return result

    return await run_in_threadpool(_work)


@app.post("/text")
async def text(req: TextRequest):
    if not STATE["ready"]:
        return {"category": "unknown", "score": 0.0}
    return await run_in_threadpool(STATE["text"].classify, req.text)


def main():
    import uvicorn

    host = os.environ.get("ML_SIDECAR_HOST", "127.0.0.1")
    port = int(os.environ.get("ML_SIDECAR_PORT", "8100"))
    uvicorn.run(app, host=host, port=port, log_level="warning")


if __name__ == "__main__":
    main()
