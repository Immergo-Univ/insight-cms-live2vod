# insight-ad-recognition — single self-contained image.
# Node.js API + Python ML sidecar (SigLIP + zero-shot text classifier + RapidOCR/PP-OCR) +
# whisper.cpp (tiny.en) + ffmpeg. No docker-compose, no external services.
#
# Notes on image size: the heavy weight comes from the ML stack (torch CPU, transformers,
# onnxruntime) which is inherent to the requirement of bundling SigLIP + Whisper in-container.
# We keep it as small as practical: slim base, CPU-only torch wheel, no pip cache, build tools
# for whisper.cpp are removed after compilation, and models are prefetched at build time.

FROM node:20-bookworm-slim

ENV DEBIAN_FRONTEND=noninteractive \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1 \
    HF_HOME=/app/ml/models_cache \
    TRANSFORMERS_NO_ADVISORY_WARNINGS=1 \
    NODE_ENV=production

WORKDIR /app

# ---- System dependencies ---------------------------------------------------------------------
# Runtime: ffmpeg, python3, libgl/glib (for opencv used by RapidOCR).
# Build-only: git, cmake, build-essential (whisper.cpp) + curl — removed afterwards.
RUN apt-get update && apt-get install -y --no-install-recommends \
      ffmpeg \
      python3 \
      python3-pip \
      python3-venv \
      libgl1 \
      libglib2.0-0 \
      ca-certificates \
      curl \
      git \
      cmake \
      build-essential \
    && rm -rf /var/lib/apt/lists/*

# ---- whisper.cpp (compile tiny.en) -----------------------------------------------------------
RUN git clone --depth 1 https://github.com/ggerganov/whisper.cpp /tmp/whisper.cpp \
    && cmake -S /tmp/whisper.cpp -B /tmp/whisper.cpp/build -DCMAKE_BUILD_TYPE=Release \
    && cmake --build /tmp/whisper.cpp/build --config Release -j "$(nproc)" \
    && cp /tmp/whisper.cpp/build/bin/whisper-cli /usr/local/bin/whisper-cli \
    && mkdir -p /app/models \
    && curl -fsSL -o /app/models/ggml-tiny.en.bin \
       https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-tiny.en.bin \
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

# ---- Prefetch ML models into the image (fully offline at runtime) ----------------------------
ENV SIGLIP_MODEL=google/siglip-base-patch16-224 \
    TEXT_MODEL=typeform/distilbert-base-uncased-mnli
RUN python3 /app/ml/prefetch.py

# ---- Runtime config --------------------------------------------------------------------------
ENV PORT=8081 \
    PYTHON_BIN=/opt/venv/bin/python3 \
    WHISPER_BIN=whisper-cli \
    WHISPER_MODEL=/app/models/ggml-tiny.en.bin \
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
