FROM node:20-alpine

RUN apk add --no-cache build-base opencv-dev curl-dev pkgconf

WORKDIR /app

# Build ads_detector
COPY backend/utils/ads-detector/ ./backend/utils/ads-detector/
RUN g++ -O2 -std=c++17 \
      -o backend/utils/bin/ads_detector \
      backend/utils/ads-detector/main.cpp \
      backend/utils/ads-detector/http.cpp \
      backend/utils/ads-detector/m3u8.cpp \
      backend/utils/ads-detector/logo_detector.cpp \
      $(pkg-config --cflags --libs opencv4) \
      -lcurl

# Install and build frontend
COPY frontend/package.json frontend/package-lock.json* ./frontend/
RUN cd frontend && npm ci
COPY frontend/ ./frontend/
RUN cd frontend && npm run build

# Install backend deps
COPY backend/package.json backend/package-lock.json* ./backend/
RUN cd backend && npm ci --omit=dev

# Copy backend source
COPY backend/src ./backend/src

EXPOSE 3001

ENV NODE_ENV=production

CMD ["node", "backend/src/index.js"]
