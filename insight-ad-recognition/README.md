# insight-ad-recognition

API que determina, para un canal en vivo (o un archivo), si lo que se está reproduciendo **en este momento** es un **comercial (ad)**, un **programa** o una **pantalla en negro**, analizando una ventana corta del stream.

Todo corre dentro de **un único contenedor**: la API Node.js orquesta `ffmpeg`, `whisper.cpp` y un **sidecar Python** que carga **SigLIP**, un **clasificador de texto (zero-shot / BERT)** y **OCR (RapidOCR = modelos PP-OCR de PaddleOCR sobre onnxruntime)**.

> Cumple los requisitos del documento `docs/insight-ad-recognition.md`: API 100% Node.js (JavaScript, sin TypeScript), Express + CORS, secret configurable, requests concurrentes, todo el stack ML dentro del mismo contenedor, Dockerfile único de un solo paso (sin docker-compose), expuesto en el puerto **8081**.

---

## Endpoint

```
GET /detect?video=<url mp4 o m3u8>[&verbose=1]
```

- `video` **(obligatorio)**: URL de un `.mp4` o `.m3u8`. Para `m3u8` live se toma el **final del stream** (live edge). Si es una **master playlist**, se elige la **rendition de menor resolución** para capturar más rápido.
- `verbose=1` (opcional): incluye el perfil completo del segmento y metadata del pipeline.

### Autenticación

Secret compartido vía `API_SECRET`. Se envía como:

- Header `x-api-secret: <secret>`, o
- Header `Authorization: Bearer <secret>`, o
- Query `?secret=<secret>`

Si `API_SECRET` está vacío, la autenticación queda deshabilitada.

### Respuesta (compacta)

```json
{
  "detection": "ad",
  "score": 0.92,
  "timestamp": 1783197785
}
```

`detection` ∈ `"ad" | "program" | "black"`.

### Respuesta (`verbose=1`)

Incluye además el objeto `profile` con el perfilado del segmento:

```json
{
  "detection": "ad",
  "score": 0.92,
  "timestamp": 1783197785,
  "profile": {
    "duration": 5.0,
    "energy_avg": 0.50,
    "scene_change_rate": 0.82,
    "motion_avg": 0.73,
    "blackscreen_ratio": 0.20,
    "audio_category": "TV Commercial",
    "audio_category_score": 0.85,
    "audio_rms": 0.91,
    "audio_dynamic_range": 0.34,
    "speech_ratio": 0.67,
    "music_probability": 0.92,
    "silence_ratio": 0.01,
    "video_category_avg": "TV Commercial",
    "video_category_score_avg": 0.56,
    "ocr_brand": true,
    "ocr_price": true,
    "ocr_cta": true,
    "ocr_legal": true,
    "ocr_news": false,
    "ocr_sports": false,
    "ocr_credits": false,
    "ocr_text_density": 0.41,
    "ocr_word_count": 58,
    "channel_logo_present": false,
    "ticker_present": false,
    "lower_third_present": false,
    "dominant_color_change": 0.78,
    "confidence": 0.92
  },
  "meta": { "elapsedMs": 640, "transcript": "...", "reasons": ["vision:TV commercial", "ocr:ad_cues=3"] }
}
```

### `GET /health`

Liveness/readiness (sin auth). Reporta si el sidecar de modelos está listo.

---

## Pipeline

```mermaid
flowchart TB
  In[GET /detect?video] --> M[media.service: m3u8 -> lowest rendition -> live edge]
  M --> FF[ffmpeg: N frames 1/s + audio 16kHz mono]
  FF --> V[frames.service: energy / motion / scene_change / blackscreen / color]
  FF --> A[audio.service: rms / dynamic_range / silence]
  FF --> W[whisper.cpp tiny.en: transcript EN + speech_ratio]
  FF --> S[sidecar /vision: SigLIP + OCR (ocr_*, ticker, lower_third)]
  W --> T[sidecar /text: comercial vs programa]
  V & A & W & S & T --> P[profile.service: arma JSON]
  P --> C[classifier.service: algoritmo determinista]
  C --> Out[detection + score + timestamp]
```

1. **Resolución de input**: parseo de la playlist HLS, selección de la rendition más liviana y de los segmentos del *live edge*.
2. **Extracción**: `ffmpeg` saca 1 frame por segundo (5 por defecto) y el audio.
3. **Métricas locales de video** (sin ML, con `sharp`): `energy_avg`, `motion_avg`, `scene_change_rate`, `blackscreen_ratio`, `dominant_color_change`.
4. **Métricas de audio** (`ffmpeg astats`/`silencedetect`): `audio_rms`, `audio_dynamic_range`, `silence_ratio`, `music_probability`.
5. **Transcripción** con `whisper.cpp` (modelo `tiny.en`) → texto en inglés + `speech_ratio`.
6. **Visión** (SigLIP zero-shot) sobre las 13 categorías + **OCR** → campos `ocr_*` y flags de layout.
7. **Texto** → clasificador comercial/programa (`audio_category`, `audio_category_score`).
8. **Clasificador determinista**: combina todas las señales con pesos transparentes y decide `ad`/`program`/`black`.

El clasificador determinista vive en `src/services/classifier.service.js` y es fácilmente ajustable.

---

## Variables de entorno

Ver `.env.example`. Las principales:

| Variable | Default | Descripción |
|----------|---------|-------------|
| `PORT` | `8081` | Puerto HTTP |
| `API_SECRET` | _(vacío)_ | Secret requerido (vacío = sin auth) |
| `SEGMENT_SECONDS` | `5` | Duración de la ventana analizada |
| `FRAMES_PER_SECOND` | `1` | Frames por segundo extraídos |
| `MAX_CONCURRENT_JOBS` | `4` | Jobs pesados concurrentes (el resto encola) |
| `WHISPER_MODEL` | `/app/models/ggml-tiny.en.bin` | Modelo whisper.cpp |
| `SIGLIP_MODEL` | `google/siglip-base-patch16-224` | Modelo de visión |
| `TEXT_MODEL` | `typeform/distilbert-base-uncased-mnli` | Clasificador de texto |
| `ML_SIDECAR_PORT` | `8100` | Puerto interno del sidecar Python |

---

## Build & run (Docker)

```bash
# Desde insight-cms-live2vod/insight-ad-recognition
docker build -t insight-ad-recognition .

docker run --rm -p 8081:8081 -e API_SECRET=mi-secreto insight-ad-recognition
```

Prueba:

```bash
curl "http://localhost:8081/detect?video=https://host/live/playlist.m3u8&secret=mi-secreto"
curl "http://localhost:8081/detect?video=https://host/live/playlist.m3u8&verbose=1" -H "x-api-secret: mi-secreto"
```

> El primer arranque compila/descarga nada en runtime: los modelos ya quedaron **prefetch** en la imagen. El sidecar tarda ~unos segundos en cargar los modelos en memoria; `/health` indica `sidecarReady`.

---

## Desarrollo local (sin Docker)

Requiere en el host: `ffmpeg`, `whisper-cli` (whisper.cpp) + modelo `tiny.en`, Python 3 con las deps de `ml/requirements.txt` (+ torch CPU).

```bash
npm install
cp .env.example .env   # ajustar rutas de WHISPER_MODEL, etc.
npm run dev
```

---

## Notas de diseño

- **Concurrencia**: Express acepta requests concurrentes; un semáforo (`MAX_CONCURRENT_JOBS`) acota los jobs pesados. El sidecar corre inferencia en un threadpool con locks por modelo.
- **Degradación elegante**: si el sidecar o whisper no están disponibles, la API sigue respondiendo con las señales locales (video/audio) y lo refleja en `meta`.
- **Peso de imagen**: el stack ML (torch CPU + transformers + onnxruntime) es la mayor parte del tamaño; se usa base slim, wheel CPU de torch, sin caché de pip y se remueven las herramientas de compilación tras buildear whisper.cpp.
- **OCR**: se usa RapidOCR (modelos PP-OCR de PaddleOCR ejecutados sobre onnxruntime) para evitar la dependencia pesada de `paddlepaddle` manteniendo los mismos modelos de PaddleOCR.
- **Objetivo de latencia (<1s)**: alcanzable con modelos ya cargados y hardware adecuado; en CPU modesta puede ser mayor. Ajustar `SEGMENT_SECONDS`, `FRAMES_PER_SECOND` y los modelos para balancear precisión/latencia.
