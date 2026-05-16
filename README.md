# Insight CMS Live2VOD

Toolkit **Live → VOD** compuesto por:

- **Frontend**: React + Vite (con proxy a `/api` durante desarrollo).
- **Backend**: Node.js + Express (expone endpoints `/api/*` y en producción sirve el build del frontend desde `frontend/dist`).

---

## Español

### Requisitos (Ubuntu 24.04 pristino)

#### Paquetes base

```bash
sudo apt update
sudo apt install -y ca-certificates curl git
```

#### Node.js (recomendado: 20 LTS o superior)

Ubuntu puede traer una versión de Node más vieja. Para evitar problemas con `node --watch`, se recomienda Node 20+.

Opción A (recomendada): NodeSource

```bash
sudo apt install -y ca-certificates curl gnupg
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs
node -v
npm -v
```

Opción B: `nvm` (si preferís manejar versiones)

- Instalá `nvm` y luego `nvm install 20 && nvm use 20`.

---

### Instalación del proyecto

> Este repo contiene `node_modules/` en `backend/`, pero lo recomendado para un entorno limpio es reinstalar dependencias con `npm ci`/`npm install`.

#### Backend

```bash
cd backend
npm install
```

Variables de entorno (opcional, recomendado):

- **`PORT`**: puerto del backend (default `3001`)
- **`INSIGHT_API_BASE`**: base URL de Insight API (default en código)
- **`INSIGHT_AUTH_TOKEN`**: token Bearer para Insight API (**recomendado setearlo por env**, no hardcode)

**YouTube / sindicación (OAuth)** — podés guardar **Client ID**, **client secret** y **redirect URI** en **Admin → Ajustes → Sindicación → YouTube** (tabla `app_settings` en Postgres). **X / Twitter** y **Facebook** tienen el mismo patrón en sus paneles de Sindicación. Si un campo queda vacío en la base, se usa el valor de entorno del backend.

Alternativa / respaldo por entorno del proceso Node:

- **`YOUTUBE_CLIENT_ID`**, **`YOUTUBE_CLIENT_SECRET`**, **`YOUTUBE_REDIRECT_URI`** (callback del backend, p. ej. `https://<tu-api>/api/tenants/oauth/youtube/callback`).

**X / Twitter (sindicación OAuth 2.0)** — igual que YouTube: **Admin → Ajustes → Sindicación → Twitter / X** en `app_settings`, o variables de entorno si el campo en BD está vacío.

- **`TWITTER_CLIENT_ID`**, **`TWITTER_CLIENT_SECRET`**, **`TWITTER_REDIRECT_URI`** (callback del backend, p. ej. `https://<tu-api>/api/tenants/oauth/twitter/callback`).
- Opcional: **`TWITTER_OAUTH_FRONTEND_REDIRECT`**, **`TWITTER_OAUTH_STATE_SECRET`**. Desarrollo: **`TWITTER_ALLOW_MOCK_AUTH=true`** para simular cuenta conectada sin OAuth real.

**Facebook (sindicación a Página)** — **Admin → Ajustes → Sindicación → Facebook** en `app_settings`, o variables de entorno si el campo en BD está vacío.

- **`FACEBOOK_APP_ID`**, **`FACEBOOK_APP_SECRET`**, **`FACEBOOK_REDIRECT_URI`** (callback del backend, p. ej. `https://<tu-api>/api/tenants/oauth/facebook/callback`).
- Opcional: **`FACEBOOK_OAUTH_FRONTEND_REDIRECT`**, **`FACEBOOK_OAUTH_STATE_SECRET`**. Desarrollo: **`FACEBOOK_ALLOW_MOCK_AUTH=true`** para simular conexión sin OAuth real.
- Tras OAuth, el editor pide **elegir una Página** de Facebook antes de activar sindicación por clip. El MP4 del encode debe ser accesible por URL pública para que Meta lo descargue (`file_url`).

**Instagram (Reels y feed)** — **Admin → Ajustes → Sindicación → Instagram** en `app_settings`, o variables de entorno si el campo en BD está vacío.

- **`INSTAGRAM_APP_ID`**, **`INSTAGRAM_APP_SECRET`**, **`INSTAGRAM_REDIRECT_URI`** (callback del backend, p. ej. `https://<tu-api>/api/tenants/oauth/instagram/callback`).
- Opcional: **`INSTAGRAM_OAUTH_FRONTEND_REDIRECT`**, **`INSTAGRAM_OAUTH_STATE_SECRET`**. Desarrollo: **`INSTAGRAM_ALLOW_MOCK_AUTH=true`** para simular conexión sin OAuth real.
- Requisitos Meta: cuenta Instagram Business o Creator vinculada a una Página de Facebook, permiso `instagram_content_publish`, y MP4 del encode accesible por URL pública.
- Tras OAuth, el editor pide **elegir la cuenta de Instagram** y por clip se elige **Reels** o **Feed**.

**TikTok (Direct Post)** — **Admin → Ajustes → Sindicación → TikTok** en `app_settings`, o variables de entorno si el campo en BD está vacío.

- **`TIKTOK_CLIENT_KEY`**, **`TIKTOK_CLIENT_SECRET`**, **`TIKTOK_REDIRECT_URI`** (callback del backend, p. ej. `https://<tu-api>/api/tenants/oauth/tiktok/callback`).
- Opcional: **`TIKTOK_OAUTH_FRONTEND_REDIRECT`**, **`TIKTOK_OAUTH_STATE_SECRET`**. Desarrollo: **`TIKTOK_ALLOW_MOCK_AUTH=true`**.
- Scopes: `user.info.basic`, `video.publish`. Verificar en el portal de TikTok el prefijo de dominio de las URLs MP4 (`PULL_FROM_URL`).
- Apps no auditadas publican en modo privado hasta aprobar la [auditoría Content Posting API](https://developers.tiktok.com/application/content-posting-api).

Los scripts `npm run dev` / `npm start` del backend cargan **`backend/.env`** (`node --env-file=.env`). En producción, definí variables donde corresponda (Docker, Kubernetes, etc.); los valores en BD tienen prioridad si no están vacíos.

Scripts:

- `npm run dev`: inicia backend con `node --watch` (desarrollo)
- `npm start`: inicia backend (producción)

#### Frontend

```bash
cd frontend
npm install
```

Scripts:

- `npm run dev`: Vite dev server (default `http://localhost:5173`) con proxy de `/api` → `http://localhost:3001`
- `npm run build`: genera `frontend/dist`
- `npm run preview`: preview del build

---

### Cómo correr (desarrollo)

1) Iniciá el backend (en una terminal):

- `cd backend && npm run dev`

2) Iniciá el frontend (en otra terminal):

- `cd frontend && npm run dev`

3) Abrí el frontend con query params:

- `http://localhost:5173?accountId=<ACCOUNT_ID>&tenantId=<TENANT_ID>`

---

### Cómo correr (producción local)

1) Build del frontend:

- `cd frontend && npm run build`

2) Iniciar backend (sirve `frontend/dist` en `/`):

- `cd backend && npm start`

Luego:

- `http://localhost:3001/`

---

### API (backend)

El backend expone endpoints bajo `/api`:

- **`GET /api/channels?accountId=...&tenantId=...`**
  - Alternativamente `tenantId` puede venir por header **`x-tenant-id`**.
  - Devuelve canales mapeados (incluye `hlsStream`, `hlsMaster`, `preview`, `posterUrl`, `epgEvents`).

- **`GET /api/m3u8/date-range?hlsStream=...`**
  - Descarga el `.m3u8` y calcula el rango usando `#EXT-X-PROGRAM-DATE-TIME`.
  - Devuelve `{ startDate, endDate }` en ISO.

- **Ads (precálculo en memoria):** `GET /api/ads/precalculated`, `POST /api/ads/detect` — ver [`docs/ads-api-and-future-detection.md`](docs/ads-api-and-future-detection.md).

---

## English

### Requirements (fresh Ubuntu 24.04)

#### Base packages

```bash
sudo apt update
sudo apt install -y ca-certificates curl git
```

#### Node.js (recommended: 20 LTS or newer)

Ubuntu may ship an older Node version. To avoid issues with `node --watch`, Node 20+ is recommended.

Option A (recommended): NodeSource

```bash
sudo apt install -y ca-certificates curl gnupg
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs
node -v
npm -v
```

Option B: `nvm` (version management)

- Install `nvm`, then `nvm install 20 && nvm use 20`.

---

### Project setup

> This repo contains `node_modules/` under `backend/`, but on a clean machine it’s recommended to reinstall dependencies with `npm ci`/`npm install`.

#### Backend

```bash
cd backend
npm install
```

Environment variables (optional, recommended):

- **`PORT`**: backend port (default `3001`)
- **`INSIGHT_API_BASE`**: Insight API base URL (default is in code)
- **`INSIGHT_AUTH_TOKEN`**: Insight API Bearer token (**recommended via env**, not hardcoded)

**YouTube syndication (OAuth)** — you can store **client ID**, **client secret**, and **redirect URI** in **Admin → Settings → Syndication → YouTube** (persisted in Postgres `app_settings`). **X / Twitter** and **Facebook** use the same pattern under their Syndication panels. If a value is empty in the database, the backend environment variable is used.

Fallback / env on the Node backend process:

- **`YOUTUBE_CLIENT_ID`**, **`YOUTUBE_CLIENT_SECRET`**, **`YOUTUBE_REDIRECT_URI`** (backend callback URL, e.g. `https://<your-api>/api/tenants/oauth/youtube/callback`).

**X / Twitter syndication (OAuth 2.0)** — same pattern as YouTube: **Admin → Settings → Syndication → Twitter / X** in `app_settings`, or env vars when DB fields are empty.

- **`TWITTER_CLIENT_ID`**, **`TWITTER_CLIENT_SECRET`**, **`TWITTER_REDIRECT_URI`** (backend callback URL, e.g. `https://<your-api>/api/tenants/oauth/twitter/callback`).
- Optional: **`TWITTER_OAUTH_FRONTEND_REDIRECT`**, **`TWITTER_OAUTH_STATE_SECRET`**. Local dev: **`TWITTER_ALLOW_MOCK_AUTH=true`** to mock a connected account without real OAuth.

**Facebook Page syndication** — **Admin → Settings → Syndication → Facebook** in `app_settings`, or env vars when DB fields are empty.

- **`FACEBOOK_APP_ID`**, **`FACEBOOK_APP_SECRET`**, **`FACEBOOK_REDIRECT_URI`** (backend callback URL, e.g. `https://<your-api>/api/tenants/oauth/facebook/callback`).
- Optional: **`FACEBOOK_OAUTH_FRONTEND_REDIRECT`**, **`FACEBOOK_OAUTH_STATE_SECRET`**. Local dev: **`FACEBOOK_ALLOW_MOCK_AUTH=true`** to mock connection without real OAuth.
- After OAuth, the editor prompts to **pick a Facebook Page** before per-clip syndication. The encoded MP4 URL must be publicly reachable by Meta (`file_url` upload).

**Instagram (Reels and feed)** — **Admin → Settings → Syndication → Instagram** in `app_settings`, or env vars when DB fields are empty.

- **`INSTAGRAM_APP_ID`**, **`INSTAGRAM_APP_SECRET`**, **`INSTAGRAM_REDIRECT_URI`** (backend callback URL, e.g. `https://<your-api>/api/tenants/oauth/instagram/callback`).
- Optional: **`INSTAGRAM_OAUTH_FRONTEND_REDIRECT`**, **`INSTAGRAM_OAUTH_STATE_SECRET`**. Local dev: **`INSTAGRAM_ALLOW_MOCK_AUTH=true`** to mock connection without real OAuth.
- Meta prerequisites: Instagram Business or Creator account linked to a Facebook Page, `instagram_content_publish` permission, and a publicly reachable encoded MP4 URL.
- After OAuth, the editor prompts to **pick the Instagram account**; per clip you choose **Reels** or **Feed**.

**TikTok (Direct Post)** — **Admin → Settings → Syndication → TikTok** in `app_settings`, or env vars when DB fields are empty.

- **`TIKTOK_CLIENT_KEY`**, **`TIKTOK_CLIENT_SECRET`**, **`TIKTOK_REDIRECT_URI`** (backend callback URL, e.g. `https://<your-api>/api/tenants/oauth/tiktok/callback`).
- Optional: **`TIKTOK_OAUTH_FRONTEND_REDIRECT`**, **`TIKTOK_OAUTH_STATE_SECRET`**. Local dev: **`TIKTOK_ALLOW_MOCK_AUTH=true`**.
- Scopes: `user.info.basic`, `video.publish`. Verify your MP4 output URL domain prefix in the TikTok developer portal (`PULL_FROM_URL`).
- Unaudited apps publish as private until [Content Posting API audit](https://developers.tiktok.com/application/content-posting-api) approval.

Backend `npm run dev` / `npm start` load **`backend/.env`** via `node --env-file=.env`. Non-empty DB fields override env at runtime.

Scripts:

- `npm run dev`: start backend using `node --watch` (dev)
- `npm start`: start backend (prod)

#### Frontend

```bash
cd frontend
npm install
```

Scripts:

- `npm run dev`: Vite dev server (default `http://localhost:5173`) with `/api` proxy → `http://localhost:3001`
- `npm run build`: outputs `frontend/dist`
- `npm run preview`: preview built assets

---

### Run (development)

1) Start backend:

- `cd backend && npm run dev`

2) Start frontend:

- `cd frontend && npm run dev`

3) Open the frontend with query params:

- `http://localhost:5173?accountId=<ACCOUNT_ID>&tenantId=<TENANT_ID>`

---

### Run (local production)

1) Build frontend:

- `cd frontend && npm run build`

2) Start backend (serves `frontend/dist` on `/`):

- `cd backend && npm start`

Then:

- `http://localhost:3001/`

---

### API (backend)

- **`GET /api/channels?accountId=...&tenantId=...`**
  - `tenantId` may also be provided via **`x-tenant-id`** header.

- **`GET /api/m3u8/date-range?hlsStream=...`**
  - Downloads the playlist and computes the range using `#EXT-X-PROGRAM-DATE-TIME`.

- **Ads (in-memory precalc):** `GET /api/ads/precalculated`, `POST /api/ads/detect` — see [`docs/ads-api-and-future-detection.md`](docs/ads-api-and-future-detection.md).
