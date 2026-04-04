# Native logo-detector (C++/OpenCV). Builder must use the same libc as the runtime image (glibc / Debian).
FROM node:20-bookworm-slim AS logo-detector-build

RUN apt-get update && apt-get install -y --no-install-recommends \
    g++ \
    make \
    pkg-config \
    libopencv-dev \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /build
COPY backend/utils/logo-detector/logo-detector.cpp backend/utils/logo-detector/Makefile ./
RUN make

# whisper.cpp: transcribe final VOD and burn subtitles (CPU build)
FROM debian:bookworm-slim AS whisper-build
RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    ca-certificates \
    cmake \
    git \
    pkg-config \
    wget \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /opt/whisper-src
RUN git clone --depth 1 https://github.com/ggerganov/whisper.cpp.git . \
    && cmake -B build -DCMAKE_BUILD_TYPE=Release \
    && cmake --build build --config Release -j"$(nproc)"
RUN bash ./models/download-ggml-model.sh base
RUN mkdir -p /out/bin /out/models \
    && cp build/bin/whisper-cli /out/bin/ \
    && cp models/ggml-base.bin /out/models/

FROM node:20-bookworm-slim

WORKDIR /app

# ffmpeg: frame grab inside logo-detector; OpenCV *.so for the compiled binary; fonts for subtitle burn-in
RUN apt-get update && apt-get install -y --no-install-recommends \
    ffmpeg \
    fonts-dejavu-core \
    libopencv-core406 \
    libopencv-imgproc406 \
    libopencv-imgcodecs406 \
    && rm -rf /var/lib/apt/lists/*

RUN mkdir -p /opt/whisper/models
COPY --from=whisper-build /out/bin/whisper-cli /opt/whisper/whisper-cli
COPY --from=whisper-build /out/models/ggml-base.bin /opt/whisper/models/ggml-base.bin
RUN chmod +x /opt/whisper/whisper-cli

ENV WHISPER_CLI_PATH=/opt/whisper/whisper-cli
ENV WHISPER_MODEL_PATH=/opt/whisper/models/ggml-base.bin

# Install and build frontend
COPY frontend/package.json frontend/package-lock.json* ./frontend/
RUN cd frontend && npm ci
COPY frontend/ ./frontend/
RUN cd frontend && npm run build

# Install backend deps
COPY backend/package.json backend/package-lock.json* ./backend/
RUN cd backend && npm ci --omit=dev

COPY backend/src ./backend/src
COPY --from=logo-detector-build /build/logo-detector ./backend/utils/logo-detector/logo-detector

EXPOSE 3001

ENV NODE_ENV=production

CMD ["node", "backend/src/index.js"]
