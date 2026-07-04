FROM node:20-bookworm-slim

WORKDIR /app

# ffmpeg is used by editor widget image rendering (editor-widget-images.service.js).
RUN apt-get update && apt-get install -y --no-install-recommends \
    ffmpeg \
    && rm -rf /var/lib/apt/lists/*

# Install and build frontend
COPY frontend/package.json frontend/package-lock.json* ./frontend/
RUN cd frontend && npm ci
COPY frontend/ ./frontend/
RUN cd frontend && npm run build

COPY backend/package.json backend/package-lock.json* ./backend/
RUN cd backend && npm ci --omit=dev

COPY backend/src ./backend/src

EXPOSE 3001

ENV NODE_ENV=production

CMD ["node", "backend/src/index.js"]
