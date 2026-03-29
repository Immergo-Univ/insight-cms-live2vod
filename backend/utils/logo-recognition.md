# Logo recognition (`backend/utils`)

Herramientas **CLI** para (1) detectar la región del logo en un HLS y exportar plantilla + metadatos, y (2) marcar tramos donde el logo **no** aparece en otro HLS (útil como proxy de publicidad). **No** están integradas en la API Node.js por defecto.

En **stderr** suelen imprimirse trazas con prefijo `[logo-template-matching]` o mensajes de progreso del detector.

---

## Resumen: qué produce cada script al ejecutarse

| Script | Directorio | Artefactos principales (respecto al **cwd** al lanzar el binario) |
|--------|------------|-------------------------------------------------------------------|
| **`logo-detector`** | `logo-detector-features/` | Ver tabla detallada abajo: JSON, JPG de logo, JPG de debug, muestras temporales. |
| **`logo-template-matching`** | `logo-template-matching/` | Un JSON de segmentos “sin logo” / anuncios en `output/ads/<channel_id>.json`. |

---

## Prerrequisitos (sistema)

| Herramienta | Compilar / ejecutar |
|-------------|---------------------|
| **`logo-detector`** | `g++` C++17, **OpenCV 4**, **libcurl**, **FFmpeg** (pkg-config: `libavformat`, `libavcodec`, `libswscale`, `libavutil`) |
| **`logo-template-matching`** | `gcc` C11, **libcurl** |
| **Ejecutar ambos** | `ffmpeg`, `ffprobe` en `PATH` |

**Debian / Ubuntu (ejemplo):**

```bash
sudo apt update
sudo apt install -y build-essential pkg-config libopencv-dev libcurl4-openssl-dev \
  libavformat-dev libavcodec-dev libswscale-dev libavutil-dev ffmpeg
```

**Comprobar:**

```bash
g++ --version
pkg-config --exists opencv4 || pkg-config --exists opencv
pkg-config --exists libcurl && echo "libcurl ok"
command -v ffmpeg ffprobe
```

---

## Build

### 1) `logo-detector`

```bash
cd backend/utils/logo-detector-features
make
```

Genera el binario **`./logo-detector`** (fuente: `logo-detector.c`, compilado como C++ por OpenCV).

### 2) `logo-template-matching`

```bash
cd backend/utils/logo-template-matching
make
```

O manualmente:

```bash
gcc -O2 -std=c11 -Wall -Wextra logo-template-matching.c -o logo-template-matching -lcurl -lm
```

Genera **`./logo-template-matching`** (sin hilos; no hace falta `-lpthread`).

### 3) Opcional: `template_match` (legacy)

En la misma carpeta existe **`template_match.c`**: otro matcher (muestreo ~5 s, **pthread**, formato de export antiguo `bbox_frame_xywh` + PNG en un directorio `logos/`). El flujo recomendado con el detector actual es **`logo-template-matching`**, no este binario.

---

## 1. Detector — `logo-detector-features/logo-detector`

**Uso:**

```bash
cd backend/utils/logo-detector-features
./logo-detector '<m3u8_url_or_path>' <channel_id>
```

Ejemplo: `./logo-detector 'https://cdn/.../index.m3u8' tvj`

### Qué produce al ejecutarse

Todo se escribe bajo el **directorio de trabajo actual** (típicamente `logo-detector-features/`):

| Ruta | Descripción |
|------|-------------|
| **`output/<channel_id>.json`** | Metadatos: `channel_id`, `logo_bbox` `{x,y,width,height}` en coordenadas del **reference_frame**, `reference_frame` `{width,height}`, `confidence_score`, `orb_fallback_score`, `samples_used`, bloque `detection` (método, `proc_size`, umbrales, etc.). |
| **`output/<channel_id>_logo.jpg`** | Recorte BGR del logo desde una muestra aleatoria, tamaño acorde al bbox — **plantilla** para el paso de template matching. |
| **`output/<channel_id>_debug.jpg`** | Misma muestra que el logo, con el rectángulo del bbox dibujado (depuración visual). |
| **`samples/<channel_id>_sample_<n>.jpg`** | Durante el run se guardan las muestras usadas para la detección. **Al terminar con éxito se eliminan** estos JPEG del canal (el código limpia `samples/` para ese `channel_id`). Si el proceso falla antes, pueden quedar archivos sueltos. |

**stdout:** una línea tipo `ok: <channel_id> bbox=(...) conf=... -> output/<channel_id>.json` con la ruta del JSON generado.

**stderr:** mensajes de error si falla la descodificación HLS, OpenCV, escritura, etc.

---

## 2. Template matching / anuncios — `logo-template-matching/logo-template-matching`

**Uso (orden: URL primero, luego id de canal):**

```bash
cd backend/utils/logo-template-matching
./logo-template-matching '<m3u8_url>' <channel_id> [opciones]
```

Lee por defecto:

- `../logo-detector-features/output/<channel_id>.json` (bbox + `reference_frame`)
- `../logo-detector-features/output/<channel_id>_logo.jpg`

(Se puede cambiar con `--detector-output` o `LOGO_TM_DETECTOR_OUTPUT`.)

### Qué produce al ejecutarse

| Ruta | Descripción |
|------|-------------|
| **`output/ads/<channel_id>.json`** | Resultado del análisis: URLs de entrada y media playlist, rutas al JSON del detector y a la(s) plantilla(s), tamaños de vídeo y ROI de búsqueda, `sample_interval_seconds`, `match_threshold`, `match_method`, histéresis, `scanned_duration_seconds`, y la lista **`ad_segments`**: tramos donde el logo se considera ausente (cada ítem con tiempos en segundos, índices de muestra, y **`start_hhmmss` / `end_hhmmss`** en formato `HH:MM:SS`; el fin es **exclusivo** en el sentido `start + duration`). |

Campos útiles en el JSON:

- **`logo_template_path`**: primera plantilla usada.
- **`logo_template_paths`**: todas las rutas (si usás `--logo-jpg` / `--alt-logo-jpg`).
- **`ad_segments`**: segmentos “sin logo” tras histéresis (no equivalen a detección de publicidad por audio/metadata; solo ausencia de match con la plantilla).

**stdout:** no hay salida estructurada; el resultado va al archivo anterior.

**stderr:** líneas `[logo-template-matching]` con playlist resuelta, ROI, umbral, y por cada muestra temporal el valor de match y si el logo se considera presente.

**Opciones relevantes** (ver también `--help` implícito vía `print_usage` en el fuente):

- `--threshold 0..1` — sensibilidad del match (por defecto **0.72**).
- `--max-seconds N` — si no hay duración en el contenedor (p. ej. live).
- `--detector-output DIR` — carpeta donde están `<id>.json` y `<id>_logo.jpg`.
- `--logo-jpg PATH` / `--alt-logo-jpg PATH` — plantillas extra o sustituto cuando el bug en aire difiere del `*_logo.jpg` del detector.

---

## 3. Pipeline típico

1. **`make`** en `logo-detector-features` y en `logo-template-matching`.
2. Ejecutar **`./logo-detector`** con el `m3u8` y el `channel_id` **desde** `logo-detector-features/` → revisar **`output/<id>.json`**, **`output/<id>_logo.jpg`** y **`output/<id>_debug.jpg`**.
3. Ejecutar **`./logo-template-matching`** con el `m3u8` a analizar y el **mismo** `channel_id` **desde** `logo-template-matching/` → leer **`output/ads/<id>.json`**.
4. Opcional: ingestar esos JSON en el backend (p. ej. controladores propios).

---

## 4. Changelog

| Fecha | Cambio |
|------|--------|
| 2026-03-29 | Documentación alineada con **`logo-detector`** (`logo-detector.c` + `make`) y **`logo-template-matching`** (C, salida `output/ads/<id>.json`). Añadida descripción de **artefactos al ejecutar** cada script. |
| 2026-03-28 | Evoluciones previas del detector y del matcher (iteraciones OpenCV / Python / C); ver historial de git para detalle. |
