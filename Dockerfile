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

FROM node:20-bookworm-slim

WORKDIR /app

# ffmpeg: frame grab inside logo-detector; OpenCV *.so for the compiled binary
RUN apt-get update && apt-get install -y --no-install-recommends \
    ffmpeg \
    libopencv-core406 \
    libopencv-imgproc406 \
    libopencv-imgcodecs406 \
    && rm -rf /var/lib/apt/lists/*

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
