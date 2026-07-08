# insight-ad-recognition

API que determina, para un canal en vivo (o un archivo), si lo que se está reproduciendo **en este momento** es un **comercial (ad)**, un **programa** o un **hueco de silencio**, analizando **exclusivamente el canal de audio** de una ventana corta del stream.

Todo corre dentro de **un único contenedor**: la API Node.js orquesta `ffmpeg`, `whisper.cpp` (solo para observabilidad) y un **sidecar Python** que carga **CLAP** (Contrastive Language-Audio Pretraining — el análogo de CLIP para audio) y clasifica el audio contra una lista fija de categorías de programación.

> Cumple los requisitos del documento original: API 100% Node.js (JavaScript, sin TypeScript), Express + CORS, secret configurable, requests concurrentes, todo el stack ML dentro del mismo contenedor, Dockerfile único de un solo paso (sin docker-compose), expuesto en el puerto **8081**.

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
  "score": 0.72,
  "confidence": 0.68,
  "scores": { "ad": 0.72, "program": 0.35, "silence": 0.0 },
  "timestamp": 1783197785
}
```

`detection` ∈ `"ad" | "program" | "silence"`.

### Respuesta (`verbose=1`)

Incluye además el objeto `profile` con el perfilado audio-only del segmento:

```json
{
  "detection": "ad",
  "score": 0.72,
  "confidence": 0.68,
  "timestamp": 1783197785,
  "profile": {
    "duration": 20.0,

    "audio_rms": 0.51,
    "audio_dynamic_range": 0.34,
    "speech_ratio": 0.31,
    "music_probability": 0.72,
    "silence_ratio": 0.02,

    "audio_clap_category_avg": "Advertisement",
    "audio_clap_score_avg": 0.55,
    "audio_clap_per_category": {
      "Television commercial": 0.42,
      "Advertisement": 0.55,
      "News broadcast": 0.05,
      "Sports broadcast": 0.02,
      "Movie": 0.03,
      "TV series": 0.02,
      "Talk show": 0.02,
      "Interview": 0.01,
      "Music performance": 0.06,
      "Weather forecast": 0.01,
      "Children's program": 0.01
    },
    "audio_clap_last": {
      "startSec": 15.0,
      "endSec": 20.0,
      "category": "Television commercial",
      "score": 0.71
    },
    "audio_clap_chunks": [
      { "startSec": 0.0,  "endSec": 5.0,  "category": "News broadcast",       "score": 0.55 },
      { "startSec": 5.0,  "endSec": 10.0, "category": "News broadcast",       "score": 0.58 },
      { "startSec": 10.0, "endSec": 15.0, "category": "Advertisement",        "score": 0.65 },
      { "startSec": 15.0, "endSec": 20.0, "category": "Television commercial","score": 0.71 }
    ],
    "audio_clap_chunk_seconds": 5,

    "confidence": 0.68
  },
  "meta": {
    "elapsedMs": 1240,
    "transcript": "...",
    "audioClapAvailable": true,
    "chunks": 4,
    "chunkSeconds": 5,
    "reasons": ["clap:last=Television commercial@0.71", "clap:avg=Advertisement@0.55"]
  }
}
```

### `GET /health`

Liveness/readiness (sin auth). Reporta si el sidecar CLAP está listo.

---

## Pipeline

```mermaid
flowchart TB
  In[GET /detect?video] --> M[media.service: m3u8 -> lowest rendition -> live edge]
  M --> FF[ffmpeg: N frames 1/s (solo mosaico) + audio 48kHz mono + audio 16kHz mono]
  FF --> A[audio.service: rms / dynamic_range / silence / music_probability]
  FF --> W[whisper.cpp base multilingual: transcript + speech_ratio (observabilidad)]
  FF --> C[sidecar /audio: CLAP zero-shot en chunks de 5s]
  A & W & C --> P[profile.service: arma JSON audio-only]
  P --> D[classifier.service: veredicto por último chunk + promedio de ventana]
  D --> Out[detection + score + timestamp + timeline por chunk]
```

1. **Resolución de input**: parseo de la playlist HLS, selección de la rendition más liviana y de los segmentos del *live edge*.
2. **Extracción**: `ffmpeg` en una sola pasada saca frames para el mosaico + dos WAVs (48 kHz para CLAP, 16 kHz para whisper).
3. **Métricas de audio locales** (`ffmpeg astats`/`silencedetect`): `audio_rms`, `audio_dynamic_range`, `silence_ratio`, `music_probability`.
4. **Transcripción** con `whisper.cpp` (modelo `ggml-base` multilingüe) — sólo para observabilidad.
5. **CLAP zero-shot**: el WAV a 48 kHz se corta en chunks de 5 s y cada chunk se puntúa contra las 11 categorías. Se retorna la distribución por chunk, el promedio de ventana y el chunk final (live edge).
6. **Clasificador determinista**: el último chunk pesa 70%, el promedio pesa 30%. El silencio prolongado (`silence_ratio ≥ 0.9` + `audio_rms < 0.05`) emite `silence`.

### Categorías CLAP

```
Television commercial
Advertisement
News broadcast
Sports broadcast
Movie
TV series
Talk show
Interview
Music performance
Weather forecast
Children's program
```

Las categorías "ad-like" (por defecto `Television commercial` y `Advertisement`) flipean el veredicto a `ad`; las demás se consideran `program`. Ambas listas son configurables por env (`AD_CATEGORIES`).

---

## Variables de entorno

Ver `.env.example`. Las principales:

| Variable | Default | Descripción |
|----------|---------|-------------|
| `PORT` | `8081` | Puerto HTTP |
| `API_SECRET` | _(vacío)_ | Secret requerido (vacío = sin auth) |
| `SEGMENT_SECONDS` | `20` | Duración de la ventana analizada |
| `AUDIO_CHUNK_SECONDS` | `5` | Longitud de cada muestra CLAP dentro de la ventana |
| `AD_MIN_SCORE` | `0.35` | Score mínimo para declarar "ad" en el último chunk |
| `AD_CATEGORIES` | `["Television commercial","Advertisement"]` | Categorías que activan `ad` |
| `MAX_CONCURRENT_JOBS` | `4` | Jobs pesados concurrentes (el resto encola) |
| `WHISPER_MODEL` | `/app/models/ggml-base.bin` | Modelo whisper.cpp (observabilidad) |
| `CLAP_MODEL` | `laion/clap-htsat-unfused` | Modelo CLAP (audio zero-shot) |
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

> El primer arranque no descarga nada en runtime: el checkpoint CLAP ya quedó **prefetch** en la imagen. El sidecar tarda ~unos segundos en cargar el modelo en memoria; `/health` indica `sidecarReady`.

---

## Desarrollo local (sin Docker)

Requiere en el host: `ffmpeg`, `whisper-cli` (whisper.cpp) + modelo `ggml-base`, Python 3 con las deps de `ml/requirements.txt` (+ torch CPU).

```bash
npm install
cp .env.example .env
npm run dev
```

---

## Notas de diseño

- **Audio-only**: se removieron SigLIP + OCR (visión) del clasificador. Los frames se siguen capturando pero **solo para el mosaico de preview** — el veredicto se toma exclusivamente sobre el canal de audio, como pidieron los requerimientos.
- **CLAP en lugar de CLIP**: CLIP trabaja sobre imagen+texto; su equivalente para audio+texto es CLAP (LAION). Usa el mismo paradigma (embeddings compartidos entre modalidad y prompts de texto) sobre la señal de audio.
- **Frecuencia de muestreo**: por defecto una muestra CLAP cada **5 segundos** dentro de la ventana. Con `SEGMENT_SECONDS=20` eso da 4 muestras por probe; consumidores pueden usar la timeline (`audio_clap_chunks`) para detectar el instante exacto en que arranca un AD dentro de la ventana.
- **Concurrencia**: Express acepta requests concurrentes; un semáforo (`MAX_CONCURRENT_JOBS`) acota los jobs pesados. El sidecar corre inferencia en un threadpool con un lock sobre el modelo.
- **Degradación elegante**: si el sidecar o whisper no están disponibles, la API sigue respondiendo con las señales locales de audio (rms/silence/dynamic range) y lo refleja en `meta`.
- **Peso de imagen**: el stack ML (torch CPU + transformers + checkpoint CLAP ~380 MB) domina el tamaño. Se usa base slim, wheel CPU de torch, sin caché de pip y se remueven las herramientas de compilación tras buildear whisper.cpp.
- **Objetivo de latencia**: con CLAP unfused sobre CPU modesta, ~1-2 s por chunk. Para ventana de 20 s con 4 chunks, ~4-8 s de inferencia CLAP + extracción ffmpeg + whisper. Ajustar `SEGMENT_SECONDS`, `AUDIO_CHUNK_SECONDS` y el `CLAP_MODEL` para balancear precisión/latencia.
