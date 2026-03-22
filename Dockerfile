FROM node:20-alpine

WORKDIR /app

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
