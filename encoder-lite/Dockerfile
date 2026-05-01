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
    ttf-freefont

ENV PLAYWRIGHT_CHROMIUM_PATH=/usr/bin/chromium

COPY package.json package-lock.json* ./
RUN npm ci --omit=dev

COPY src ./src

EXPOSE 3010
ENV NODE_ENV=production
ENV PORT=3010

CMD ["node", "src/index.js"]
