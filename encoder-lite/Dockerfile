# whisper.cpp (musl / Alpine)
FROM node:20-alpine3.20 AS whisper-build
RUN apk add --no-cache \
    bash \
    build-base \
    cmake \
    coreutils \
    curl \
    git \
    perl \
    wget
WORKDIR /opt/whisper-src
RUN git clone --depth 1 https://github.com/ggerganov/whisper.cpp.git . \
    && cmake -B build -DCMAKE_BUILD_TYPE=Release \
    && cmake --build build --config Release -j"$(nproc)" --target whisper-cli
RUN sh ./models/download-ggml-model.sh base
RUN mkdir -p /out/bin /out/lib /out/models \
    && cp build/bin/whisper-cli /out/bin/ \
    && cp models/ggml-base.bin /out/models/ \
    && (find build \( -name 'libwhisper.so*' -o -name 'libggml*.so*' \) -exec cp -a {} /out/lib/ \; || true)

FROM node:20-alpine3.20

WORKDIR /app

RUN apk add --no-cache \
    ffmpeg \
    font-dejavu \
    chromium \
    nss \
    freetype \
    harfbuzz \
    ca-certificates \
    ttf-freefont \
    libgomp

ENV LD_LIBRARY_PATH=/opt/whisper/lib
ENV WHISPER_CLI_PATH=/opt/whisper/whisper-cli
ENV WHISPER_MODEL_PATH=/opt/whisper/models/ggml-base.bin
ENV PLAYWRIGHT_CHROMIUM_PATH=/usr/bin/chromium

RUN mkdir -p /opt/whisper/models /opt/whisper/lib
COPY --from=whisper-build /out/bin/whisper-cli /opt/whisper/whisper-cli
COPY --from=whisper-build /out/lib/ /opt/whisper/lib/
COPY --from=whisper-build /out/models/ggml-base.bin /opt/whisper/models/ggml-base.bin
RUN chmod +x /opt/whisper/whisper-cli

COPY package.json package-lock.json* ./
RUN npm ci --omit=dev

COPY src ./src

EXPOSE 3010
ENV NODE_ENV=production
ENV PORT=3010

CMD ["node", "src/index.js"]
