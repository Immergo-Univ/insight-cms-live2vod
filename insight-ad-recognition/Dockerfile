# insight-ad-recognition — single self-contained image.
# Node.js API (per-channel rule engine over the last frame) + Python ML sidecar (Tesseract OCR
# heb/eng/spa + perceptual hashing + NLLB-200 translation) + ffmpeg. No docker-compose, no
# external services.
#
# Image-size notes: the ML weight comes from torch (CPU) + transformers + the NLLB-200 checkpoint.
# The NLLB checkpoint is downloaded at first boot (not baked in) so the build image stays small
# enough for the DigitalOcean/kaniko builder to snapshot without OOM.

FROM node:20-bookworm-slim

ENV DEBIAN_FRONTEND=noninteractive \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1 \
    HF_HOME=/app/ml/models_cache \
    TRANSFORMERS_NO_ADVISORY_WARNINGS=1 \
    NODE_ENV=production

WORKDIR /app

# ---- System dependencies ---------------------------------------------------------------------
# Runtime: ffmpeg (last-frame extraction), python3, Tesseract OCR + Hebrew/English/Spanish
# traineddata, and libgl/glib for OpenCV (Template Matching detection method).
RUN apt-get update && apt-get install -y --no-install-recommends \
      ffmpeg \
      python3 \
      python3-pip \
      python3-venv \
      libgl1 \
      libglib2.0-0 \
      tesseract-ocr \
      tesseract-ocr-heb \
      tesseract-ocr-eng \
      tesseract-ocr-spa \
      ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# ---- Python virtualenv + ML dependencies -----------------------------------------------------
ENV VIRTUAL_ENV=/opt/venv
RUN python3 -m venv "$VIRTUAL_ENV"
ENV PATH="$VIRTUAL_ENV/bin:$PATH"

# Upgrade the pip toolchain first: Debian bookworm ships pip 23.0.1, which mis-normalizes wheel
# names (e.g. "typing_extensions" vs "typing-extensions"), discards valid wheels and falls back to
# building the sdist — which then fails because its build backend (flit_core) is not on the CPU
# wheel index that `--index-url` pins. Modern pip accepts the wheel and skips the sdist build.
RUN pip install --no-cache-dir --upgrade pip setuptools wheel

# CPU-only torch first (from the dedicated CPU wheel index to avoid CUDA payloads).
RUN pip install --no-cache-dir torch==2.5.1 --index-url https://download.pytorch.org/whl/cpu

COPY ml/requirements.txt /app/ml/requirements.txt
RUN pip install --no-cache-dir -r /app/ml/requirements.txt

# ---- Node dependencies -----------------------------------------------------------------------
# `npm install` (not `npm ci`) because this service ships without a committed package-lock.json.
COPY package.json package-lock.json* /app/
RUN if [ -f package-lock.json ]; then \
      npm ci --omit=dev --no-audit --no-fund; \
    else \
      npm install --omit=dev --no-audit --no-fund; \
    fi

# ---- Application source ----------------------------------------------------------------------
COPY src /app/src
COPY ml /app/ml

# ---- ML checkpoints: downloaded at RUNTIME, not baked into the image -------------------------
# Baking the NLLB-200 checkpoint into the image made kaniko OOM on the DigitalOcean builder during
# "Taking snapshot of files...". Instead the sidecar downloads it into $HF_HOME on first startup
# (from_pretrained pulls from the HF hub when the model isn't cached). To build an offline image on
# a bigger machine, run `python3 /app/ml/prefetch.py` at build time.
ENV NLLB_MODEL=facebook/nllb-200-distilled-600M

# ---- Runtime config --------------------------------------------------------------------------
ENV PORT=8081 \
    PYTHON_BIN=/opt/venv/bin/python3 \
    OCR_LANGUAGES=heb+eng+spa \
    OCR_MIN_CONFIDENCE=40 \
    FRAME_TAIL_SECONDS=4 \
    PREVIEW_PUBLIC_BASE_URL=https://insight-cms-live2vod-id2z9.ondigitalocean.app/insight-cms-live2vod-insight-ad \
    ML_SIDECAR_AUTOSTART=true \
    ML_SIDECAR_HOST=127.0.0.1 \
    ML_SIDECAR_PORT=8100 \
    HF_HUB_ENABLE_HF_TRANSFER=0 \
    ML_SIDECAR_START_TIMEOUT_MS=600000

EXPOSE 8081

HEALTHCHECK --interval=30s --timeout=5s --start-period=120s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+ (process.env.PORT||8081) +'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "src/index.js"]
