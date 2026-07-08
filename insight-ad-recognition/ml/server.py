"""In-container ML sidecar for insight-ad-recognition.

FastAPI server that preloads a single CLAP (Contrastive Language-Audio Pretraining) model and
exposes a `/audio` endpoint. Given a mono 48 kHz WAV extracted from the analysis window, it
returns a zero-shot classification of the audio against a fixed list of programming categories,
sliced into short chunks (5 s by default) so the caller can locate the exact chunk where an AD
starts inside the window.

The vision/SigLIP + OCR + text classifier stages of the previous pipeline have been removed:
the profile is now audio-only, which is what the deterministic classifier consumes.

Endpoints
---------
GET  /health           -> { ready: bool }
POST /audio {path, chunkSeconds?} -> { chunks[], avg{}, last{}, durationSec, chunkSeconds }
"""

import json
import os

from fastapi import FastAPI
from fastapi.concurrency import run_in_threadpool
from pydantic import BaseModel

# Kept in sync with src/config.js `audioCategories`. Env override lets the Node process pass its
# own list at startup so we don't have to redeploy the sidecar to tweak them.
DEFAULT_CATEGORIES = [
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


def _categories() -> list[str]:
    raw = os.environ.get("AUDIO_CATEGORIES")
    if raw:
        try:
            parsed = json.loads(raw)
            if isinstance(parsed, list) and parsed:
                return [str(x) for x in parsed]
        except Exception:
            pass
    return DEFAULT_CATEGORIES


app = FastAPI(title="insight-ad-recognition ML sidecar")

STATE = {"ready": False, "clap": None, "error": None}


class AudioRequest(BaseModel):
    path: str
    chunkSeconds: float | None = None


def _warmup():
    """Run one dummy inference so the FIRST real request doesn't pay the lazy graph-init cost.

    We synthesize a short 1 s sine wave at TARGET_SR, write it to a temp WAV and pass it through
    the classifier. Never blocks readiness — if warmup fails, the sidecar still serves."""
    import struct
    import tempfile
    import wave
    import math

    from audio_clap import TARGET_SR

    tmp_path = None
    try:
        with tempfile.NamedTemporaryFile(suffix=".wav", delete=False) as tf:
            tmp_path = tf.name
        # 1 second of a soft sine tone at 440 Hz.
        n = TARGET_SR
        samples = bytearray()
        for i in range(n):
            v = int(0.1 * 32767 * math.sin(2 * math.pi * 440 * i / TARGET_SR))
            samples += struct.pack("<h", v)
        with wave.open(tmp_path, "wb") as w:
            w.setnchannels(1)
            w.setsampwidth(2)
            w.setframerate(TARGET_SR)
            w.writeframes(bytes(samples))
        STATE["clap"].classify(tmp_path, chunk_seconds=1.0)
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
        from audio_clap import AudioClapClassifier

        clap_id = os.environ.get("CLAP_MODEL", "laion/clap-htsat-unfused")
        STATE["clap"] = AudioClapClassifier(clap_id, _categories())
        _warmup()
        STATE["ready"] = True
        print(f"[ml] CLAP model loaded ({clap_id}), sidecar ready", flush=True)
    except Exception as e:  # noqa: BLE001 - report and stay up in a not-ready state
        STATE["error"] = str(e)
        print(f"[ml] model load failed: {e}", flush=True)


@app.get("/health")
def health():
    return {"ready": bool(STATE["ready"]), "error": STATE["error"]}


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
