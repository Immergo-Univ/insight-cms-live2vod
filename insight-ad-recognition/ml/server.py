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


@app.on_event("startup")
def _load_models():
    try:
        from ocr_engine import OcrEngine
        from translate import Translator

        STATE["ocr"] = OcrEngine()
        translator = Translator()
        # Preload NLLB so the first translation isn't slow (best-effort — large download on first
        # boot; readiness is still reported so OCR/pHash work while the model downloads).
        try:
            translator.load()
        except Exception as e:  # noqa: BLE001
            print(f"[ml] translator preload deferred: {e}", flush=True)
        STATE["translator"] = translator
        _warmup()
        STATE["ready"] = True
        print("[ml] models loaded, sidecar ready", flush=True)
    except Exception as e:  # noqa: BLE001 - report and stay up in a not-ready state
        STATE["error"] = str(e)
        print(f"[ml] model load failed: {e}", flush=True)


@app.get("/health")
def health():
    return {
        "ready": bool(STATE["ready"]),
        "error": STATE["error"],
        "models": {
            "ocr": STATE["ocr"] is not None,
            "translator": STATE["translator"] is not None,
        },
    }


def _translate(text: str) -> str:
    tr = STATE["translator"]
    if not tr or not text:
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
