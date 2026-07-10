"""In-container ML sidecar for insight-ad-recognition (rule engine).

FastAPI server that preloads the CPU model battery and exposes:
  GET  /health                         -> { ready, error, models }
  POST /analyze { frame, rois, ... }   -> per-ROI pHash + OCR (+ EN translation) + full-screen OCR
  POST /sample  { frame }              -> template pHash + OCR (+ EN translation) for an upload

The heavy lifting is: Tesseract OCR (heb/eng/spa), perceptual hashing (imagehash) and NLLB-200
translation to English. The Node process starts this as a child and talks to it over localhost.
"""

import os

from fastapi import FastAPI
from fastapi.concurrency import run_in_threadpool
from pydantic import BaseModel


app = FastAPI(title="insight-ad-recognition ML sidecar")

STATE = {
    "ready": False,
    "ocr": None,
    "translator": None,
    "error": None,
}


class RoiSpec(BaseModel):
    id: str
    x: float = 0.0
    y: float = 0.0
    w: float = 1.0
    h: float = 1.0
    ocr: bool = False
    translate: bool = False
    # Template Matching (OpenCV) — when true, score the ROI against these sample image URLs.
    templateMatch: bool = False
    templates: list[str] = []


class AnalyzeRequest(BaseModel):
    frame: str
    fullOcr: bool = True
    translateFull: bool = True
    rois: list[RoiSpec] = []
    phashSize: int = 8


class SampleRequest(BaseModel):
    frame: str
    phashSize: int = 8


def _warmup():
    """Run one dummy OCR/pHash so the first real request doesn't pay the lazy init cost. Never
    blocks readiness — if warmup fails, the sidecar still serves."""
    import tempfile

    from PIL import Image

    img_path = None
    try:
        with tempfile.NamedTemporaryFile(suffix=".jpg", delete=False) as tf:
            img_path = tf.name
        Image.new("RGB", (224, 224), (16, 16, 16)).save(img_path, "JPEG")
        if STATE["ocr"]:
            STATE["ocr"].full_text(img_path)
        import phash

        phash.phash_image(img_path)
        print("[ml] warmup done", flush=True)
    except Exception as e:  # noqa: BLE001 - warmup must never prevent the sidecar from serving
        print(f"[ml] warmup skipped: {e}", flush=True)
    finally:
        if img_path:
            try:
                os.remove(img_path)
            except OSError:
                pass


def _load_nllb_background(translator):
    """Load NLLB-200 off the startup path. OCR + pHash (which don't need it) serve immediately;
    translation (ocrTextEn) turns on once this finishes. The checkpoint is large and downloads on
    first boot, so blocking startup on it would make the whole sidecar unreachable meanwhile."""
    try:
        translator.load()
        print("[ml] NLLB loaded, translation online", flush=True)
    except Exception as e:  # noqa: BLE001
        print(f"[ml] NLLB load failed (translation disabled): {e}", flush=True)


@app.on_event("startup")
def _load_models():
    try:
        import threading

        from ocr_engine import OcrEngine
        from translate import Translator

        STATE["ocr"] = OcrEngine()
        STATE["translator"] = Translator()
        _warmup()
        # Ready as soon as OCR + pHash work; do NOT block on the NLLB download.
        STATE["ready"] = True
        print("[ml] OCR+pHash ready; loading NLLB in background", flush=True)
        threading.Thread(
            target=_load_nllb_background, args=(STATE["translator"],), daemon=True
        ).start()
    except Exception as e:  # noqa: BLE001 - report and stay up in a not-ready state
        STATE["error"] = str(e)
        print(f"[ml] model load failed: {e}", flush=True)


@app.get("/health")
def health():
    tr = STATE["translator"]
    return {
        "ready": bool(STATE["ready"]),
        "error": STATE["error"],
        "models": {
            "ocr": STATE["ocr"] is not None,
            # translator present as soon as constructed; `translationReady` flips once NLLB loads.
            "translator": tr is not None,
            "translationReady": bool(tr and tr.is_ready()),
        },
    }


def _translate(text: str) -> str:
    tr = STATE["translator"]
    # Skip while NLLB is still loading in the background (don't block detect on the download);
    # ocrTextEn just stays empty until translation comes online.
    if not tr or not text or not tr.is_ready():
        return ""
    try:
        return tr.translate(text)
    except Exception as e:  # noqa: BLE001
        print(f"[ml] translate failed: {e}", flush=True)
        return ""


@app.post("/analyze")
async def analyze(req: AnalyzeRequest):
    if not STATE["ready"]:
        return {"error": "models not ready", "fullOcr": {"text": "", "textEn": ""}, "rois": []}

    def _work():
        import phash

        ocr = STATE["ocr"]
        hash_size = max(4, int(req.phashSize or 8))

        full_text = ocr.full_text(req.frame) if req.fullOcr else ""
        full_text_en = _translate(full_text) if (req.translateFull and full_text) else ""

        roi_out = []
        for roi in req.rois:
            roi_dict = {"x": roi.x, "y": roi.y, "w": roi.w, "h": roi.h}
            entry = {"id": roi.id, "phash": phash.phash_crop(req.frame, roi_dict, hash_size)}
            if roi.templateMatch and roi.templates:
                import template_match

                entry["templateScore"] = template_match.match_roi(req.frame, roi_dict, roi.templates)
            else:
                entry["templateScore"] = 0.0
            if roi.ocr:
                roi_text = ocr.crop_text(req.frame, roi_dict)
                entry["ocrText"] = roi_text
                entry["ocrTextEn"] = _translate(roi_text) if (roi.translate and roi_text) else ""
            else:
                entry["ocrText"] = ""
                entry["ocrTextEn"] = ""
            roi_out.append(entry)

        return {"fullOcr": {"text": full_text, "textEn": full_text_en}, "rois": roi_out}

    return await run_in_threadpool(_work)


@app.post("/sample")
async def sample(req: SampleRequest):
    if not STATE["ready"]:
        return {"error": "models not ready", "phash": "", "ocrText": "", "ocrTextEn": ""}

    def _work():
        import phash

        ocr = STATE["ocr"]
        hash_size = max(4, int(req.phashSize or 8))
        text = ocr.full_text(req.frame)
        return {
            "phash": phash.phash_image(req.frame, hash_size),
            "ocrText": text,
            "ocrTextEn": _translate(text) if text else "",
        }

    return await run_in_threadpool(_work)


def main():
    import uvicorn

    host = os.environ.get("ML_SIDECAR_HOST", "127.0.0.1")
    port = int(os.environ.get("ML_SIDECAR_PORT", "8100"))
    uvicorn.run(app, host=host, port=port, log_level="warning")


if __name__ == "__main__":
    main()
