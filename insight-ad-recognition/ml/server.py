"""In-container ML sidecar for insight-ad-recognition (multimodal, audio classifier removed).

FastAPI server that preloads the CPU model battery and exposes:
  GET  /health          -> { ready, error, models }
  POST /vision {frames}  -> SigLIP category avg + OCR text/cues geometry + overlay flags
  POST /text   {text}    -> semantic ad-intent labels (mDeBERTa zero-shot)

The CLAP audio classifier was removed (it misclassified ads/newscasts as "Sports broadcast" too
often to be useful); ad/program is now decided from visual + OCR + overlays + BERT text, plus the
local ffmpeg audio metrics (RMS / silence / music) computed on the Node side.

The Node process starts this as a child and talks to it over localhost. Models load once so
per-request inference is fast; each model call is guarded by its own lock for concurrent safety.
"""

import json
import os

from fastapi import FastAPI
from fastapi.concurrency import run_in_threadpool
from pydantic import BaseModel


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
    "error": None,
}


class VisionRequest(BaseModel):
    frames: list[str]


class TextRequest(BaseModel):
    text: str = ""


class LogoRequest(BaseModel):
    frames: list[str]
    # mode "detect": auto-locate ROI + return a sample crop. mode "match": match ROI vs templates.
    mode: str = "detect"
    roi: dict | None = None
    templates: list[str] | None = None  # base64-encoded template crops (for mode="match")


def _warmup():
    """Run one dummy inference per model so the FIRST real request doesn't pay the lazy graph-init
    cost. Never blocks readiness — if warmup fails, the sidecar still serves."""
    import tempfile

    from PIL import Image

    img_path = None
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
        print("[ml] warmup inference done", flush=True)
    except Exception as e:  # noqa: BLE001 - warmup must never prevent the sidecar from serving
        print(f"[ml] warmup skipped: {e}", flush=True)
    finally:
        if img_path:
            try:
                os.remove(img_path)
            except OSError:
                pass


@app.on_event("startup")
def _load_models():
    try:
        from vision_siglip import SiglipClassifier
        from ocr_engine import OcrEngine
        from overlay_detect import OverlayDetector
        from text_classifier import TextCommercialClassifier

        siglip_id = os.environ.get("SIGLIP_MODEL", "google/siglip-base-patch16-224")
        text_id = os.environ.get("TEXT_MODEL", "MoritzLaurer/mDeBERTa-v3-base-mnli-xnli")

        STATE["siglip"] = SiglipClassifier(siglip_id, _visual_category_prompts())
        STATE["ocr"] = OcrEngine()
        STATE["overlay"] = OverlayDetector()
        STATE["text"] = TextCommercialClassifier(text_id)
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


@app.post("/logo")
async def logo(req: LogoRequest):
    # Logo ROI detection/matching is pure OpenCV — no preloaded model needed, so it works even if
    # the transformer models aren't ready yet.
    import logo_roi

    frames = req.frames or []

    def _work():
        if req.mode == "match":
            return logo_roi.match(frames, req.roi or {}, req.templates or [])
        return logo_roi.detect_roi(frames)

    return await run_in_threadpool(_work)


def main():
    import uvicorn

    host = os.environ.get("ML_SIDECAR_HOST", "127.0.0.1")
    port = int(os.environ.get("ML_SIDECAR_PORT", "8100"))
    uvicorn.run(app, host=host, port=port, log_level="warning")


if __name__ == "__main__":
    main()
