# insight-ad-recognition — single self-contained image.
# Node.js API + Python ML sidecar (SigLIP vision + Tesseract OCR heb/eng/spa + OpenCV overlays +
# mDeBERTa text + CLAP audio) + whisper.cpp (multilingual ggml-base) + ffmpeg. No docker-compose,
# no external services.
#
# Notes on image size: the heavy weight comes from the ML stack (torch CPU + transformers +
# SigLIP/mDeBERTa/CLAP checkpoints) which is inherent to bundling the multimodal battery
# in-container. We keep it as small as practical: slim base, CPU-only torch wheel, no pip cache,
# build tools for whisper.cpp are removed after compilation, and models are prefetched at build.

FROM node:20-bookworm-slim

ENV DEBIAN_FRONTEND=noninteractive \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1 \
    HF_HOME=/app/ml/models_cache \
    TRANSFORMERS_NO_ADVISORY_WARNINGS=1 \
    NODE_ENV=production

WORKDIR /app

# ---- System dependencies ---------------------------------------------------------------------
# Runtime: ffmpeg (frame + audio extraction), python3, libgl/glib (OpenCV + transformers image
# preprocessing), Tesseract OCR + Hebrew/English/Spanish traineddata.
# Build-only: git, cmake, build-essential (whisper.cpp) + curl — removed afterwards.
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
      curl \
      git \
      cmake \
      build-essential \
    && rm -rf /var/lib/apt/lists/*

# ---- whisper.cpp (compile + multilingual ggml-base model) ------------------------------------
# ggml-base (multilingual) is used instead of *.en so Hebrew/Spanish/English are all supported.
# Whisper is kept only for observability (transcript + speech_ratio); the AD/program verdict is
# derived from the multimodal fusion (SigLIP + OCR + overlays + mDeBERTa + CLAP).
RUN git clone --depth 1 https://github.com/ggerganov/whisper.cpp /tmp/whisper.cpp \
    && cmake -S /tmp/whisper.cpp -B /tmp/whisper.cpp/build -DCMAKE_BUILD_TYPE=Release \
    && cmake --build /tmp/whisper.cpp/build --config Release -j "$(nproc)" \
    && cp /tmp/whisper.cpp/build/bin/whisper-cli /usr/local/bin/whisper-cli \
    && mkdir -p /app/models \
    && curl -fsSL -o /app/models/ggml-base.bin \
       https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base.bin \
    && rm -rf /tmp/whisper.cpp

# ---- Python virtualenv + ML dependencies -----------------------------------------------------
ENV VIRTUAL_ENV=/opt/venv
RUN python3 -m venv "$VIRTUAL_ENV"
ENV PATH="$VIRTUAL_ENV/bin:$PATH"

# CPU-only torch first (from the dedicated CPU wheel index to avoid CUDA payloads).
RUN pip install --no-cache-dir torch==2.5.1 --index-url https://download.pytorch.org/whl/cpu

COPY ml/requirements.txt /app/ml/requirements.txt
RUN pip install --no-cache-dir -r /app/ml/requirements.txt

# ---- Node dependencies -----------------------------------------------------------------------
COPY package.json package-lock.json* /app/
RUN npm ci --omit=dev || npm install --omit=dev

# ---- Application source ----------------------------------------------------------------------
COPY src /app/src
COPY ml /app/ml

# ---- Prefetch the ML checkpoints into the image (fully offline at runtime) -------------------
ENV SIGLIP_MODEL=google/siglip-base-patch16-224 \
    TEXT_MODEL=MoritzLaurer/mDeBERTa-v3-base-mnli-xnli \
    CLAP_MODEL=laion/clap-htsat-unfused
RUN python3 /app/ml/prefetch.py

# ---- Runtime config --------------------------------------------------------------------------
ENV PORT=8081 \
    PYTHON_BIN=/opt/venv/bin/python3 \
    WHISPER_BIN=whisper-cli \
    WHISPER_MODEL=/app/models/ggml-base.bin \
    WHISPER_LANGUAGE=auto \
    OCR_LANGUAGES=heb+eng+spa \
    SEGMENT_SECONDS=10 \
    AUDIO_CHUNK_SECONDS=5 \
    HEAVY_MAX_FRAMES=5 \
    PREVIEW_PUBLIC_BASE_URL=https://insight-cms-live2vod-id2z9.ondigitalocean.app/insight-cms-live2vod-insight-ad \
    ML_SIDECAR_AUTOSTART=true \
    ML_SIDECAR_HOST=127.0.0.1 \
    ML_SIDECAR_PORT=8100

# Drop build toolchain to slim the final image (keep ffmpeg/python/libs).
RUN apt-get purge -y git cmake build-essential curl \
    && apt-get autoremove -y \
    && rm -rf /var/lib/apt/lists/*

EXPOSE 8081

HEALTHCHECK --interval=30s --timeout=5s --start-period=120s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+ (process.env.PORT||8081) +'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "src/index.js"]
