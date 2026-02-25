# Insight CMS Live2VOD

Toolkit **Live → VOD** compuesto por:

- **Frontend**: React + Vite (con proxy a `/api` durante desarrollo).
- **Backend**: Node.js + Express (expone endpoints `/api/*` y en producción sirve el build del frontend desde `frontend/dist`).
- **(Opcional) Ads detector**: utilitario C++ `backend/utils/ads-detector` para detectar ventanas de ads en un stream HLS (`.m3u8`) en base a ausencia de logo.

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

#### Dependencias del ads-detector (C++ / OpenCV) (opcional)

Solo si vas a **compilar/ejecutar** `backend/utils/ads-detector`:

```bash
sudo apt install -y build-essential pkg-config
sudo apt install -y libopencv-dev libcurl4-openssl-dev
```

Notas:

- OpenCV en Ubuntu suele venir compilado con backend FFmpeg para `cv::VideoCapture` (HLS/m3u8). Si tenés problemas abriendo streams, instalá también `ffmpeg`.

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

---

### Ads detector (C++) (opcional)

Código fuente:

- `backend/utils/ads-detector/*.cpp`

Dependencias:

- OpenCV (`libopencv-dev`)
- libcurl (`libcurl4-openssl-dev`)

El binario esperado (según doc) es:

- `backend/utils/bin/ads_detector`

Ejemplo de uso (según `docs/ads-detector.mdc`):

```bash
bin/ads_detector --m3u8 "https://.../streamPlaylist.m3u8?startTime=...&endTime=..." --tr --output backend/utils/ads_output.json --debug
```

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

#### Ads detector dependencies (C++ / OpenCV) (optional)

Only if you want to **compile/run** `backend/utils/ads-detector`:

```bash
sudo apt install -y build-essential pkg-config
sudo apt install -y libopencv-dev libcurl4-openssl-dev
```

Notes:

- Ubuntu OpenCV is usually built with FFmpeg backend for `cv::VideoCapture` (HLS/m3u8). If you have trouble opening HLS streams, also install `ffmpeg`.

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

