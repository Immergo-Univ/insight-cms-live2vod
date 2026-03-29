# Logo recognition (`backend/utils`)

Herramientas **CLI** para estimar la posición de un logo desde HLS (`logo_detector`) y detectar tramos sin logo en un VOD (`template_match`). **No** están integradas en la API Node.js.

En **stderr** imprimen trazas de progreso con prefijo `[logo_detector]` o `[template_match]` (HTTP, playlist, ffprobe, ffmpeg, workers). El detector nuevo escribe la ruta del JSON principal en **stdout** (una línea).

---

## Prerrequisitos (sistema)

| Uso | Paquetes / herramientas |
|-----|-------------------------|
| **`logo_detector`** (compilar) | `build-essential`, `pkg-config`, **OpenCV 4** (`libopencv-dev` o equivalente), `libcurl4-openssl-dev` |
| **`template_match`** (compilar) | `build-essential`, `libcurl4-openssl-dev` |
| **Ejecutar** | `ffmpeg`, `ffprobe` en `PATH` |

**Debian / Ubuntu (ejemplo):**

```bash
sudo apt update
sudo apt install -y build-essential pkg-config libopencv-dev libcurl4-openssl-dev ffmpeg
```

**Comprobar:**

```bash
g++ --version
pkg-config --exists opencv4 || pkg-config --exists opencv
pkg-config --exists libcurl && echo "libcurl ok"
command -v ffmpeg ffprobe
```

---

## Build (desde la raíz del repo)

Los comandos siguientes asumen el directorio del repo (ajustá el `cd`).

### 1) `logo_detector` (C++17 + OpenCV)

```bash
cd backend/utils/logo-detector-features
make
```

Equivale a compilar `logo_detector.cpp` con `pkg-config` para OpenCV (`opencv4` u `opencv`), `-lcurl` y `-pthread`.

**Comprobar:** `test -x ./logo_detector && echo OK`

### 2) `template_match`

```bash
cd backend/utils/logo-template-matching
gcc -O2 -std=c11 -Wall -Wextra template_match.c -o template_match -lcurl -lpthread -lm
```

**Comprobar:** `test -x ./template_match && echo OK`

---

## 1. Detector — `logo-detector-features/logo_detector`

**Binario:** `./logo_detector` (compilar con `make` en esa carpeta).

### Estrategia

1. **HLS** — Igual que antes: descarga con **libcurl**, playlist **master** → variante con mayor `BANDWIDTH`, parseo de segmentos y duración total por `#EXTINF`, **ffprobe** para **WxH** (primer segmento o URL de media).
2. **Muestreo temporal** — Por defecto, constante en código **`kTimelineSampleIntervalFraction`** (p. ej. **0,10** ⇒ **10** fotogramas, un centro de bin cada ~**10 %** de la duración: \((i + 0{,}5) \cdot dur / N\)). Límites **`kMinNumTimelineSamples`** / **`kMaxNumTimelineSamples`** (2–200). **`--sample-percent PCT`** (opcional) sustituye ese criterio por \(N = \mathrm{round}(100/\mathrm{PCT})\) con los mismos límites.
3. **Decodificación en paralelo (acotada)** — Varios hilos, pero el número de **ffmpeg concurrentes** se limita con **`--decode-jobs`** (por defecto **3**) para no saturar el CDN (muchas conexiones TLS a la vez suelen provocar *connection reset*). Cada trabajo usa **ffmpeg** con **`-rw_timeout`** (microsegundos) antes de **`-i`** para no quedarse colgado indefinidamente si el servidor corta la lectura HLS. Tras cada muestra se escribe en stderr **`decode start` / `decode done` OK o FAIL** con duración en ms.
4. **Barrido 100×100** — Ventana cuadrada **100×100** con paso configurable en código (`kDefaultStride`, por defecto **50**). Por cada subimagen se arma un descriptor **normalizado L2** (para usar **coseno = producto escalar**):
   - **Histograma** — BGR, **16** bins por canal.
   - **Contornos** — Canny, `findContours`, conteo (log), área relativa del mayor contorno, **momentos de Hu** (7) en escala log.
   - **Energía** — media de **Laplaciano²** en gris.
   Cada patch guarda **índice de imagen**, **x, y, w, h**.
5. **Agrupación por coseno** — Para cada par de patches, si el coseno ≥ umbral (**~0,88**), se unen en una **estructura DSU** (componentes conexas). Los pares que superan el umbral se mantienen en memoria como lista `(i, j)`.
6. **Elección de cluster** — Se prioriza la componente más grande con al menos **8** patches y patches en **≥ 3** imágenes distintas; si no hay, se usa la componente más grande como *fallback*.
7. **Salida** — **`logos.json`** en **`<output-dir>/logos.json`**: `average_bbox_xywh` (promedio de **x** e **y** de los miembros; **w** y **h** = 100), lista **`members`** con `image_index` y bbox por patch, metadatos de canal y URLs.

**Nota sobre `template_match`:** el matcher sigue esperando un JSON **antiguo** en `logos-dir` con `bbox_frame_xywh`, `reference_frame_wh` y `png_filename` (recorte PNG junto al JSON). El detector OpenCV **no** genera ese formato ni el PNG de plantilla; el pipeline detector → template_match **no está alineado** hasta que se adapte uno de los dos lados.

### Argumentos

| Argumento | Obligatorio | Descripción |
|-----------|-------------|-------------|
| `<m3u8_url>` | **Sí** | URL o ruta a playlist **master** o **media** (`.m3u8`). El argumento que no empieza por `-`. |
| `--channel <id>` | **Sí** | Identificador del canal (metadato en JSON; ej. `tvj`). |
| `--output-dir <DIR>` | No (default: `./output`) | Directorio base: **`samples/`** y **`logos.json`**. |
| `--sample-percent <PCT>` | No | Sin flag: \(N\) sale de **`kTimelineSampleIntervalFraction`** en `logo_detector.cpp`. Con flag: \(N \approx 100/\mathrm{PCT}\). |
| `--decode-jobs <N>` | No (default: `3`) | Máximo de procesos **ffmpeg** en paralelo (rango 1–32). Bajar a **1–2** si ves errores TLS o *reset by peer*. |
| `--verbose-ffmpeg` | No | Pone el loglevel de ffmpeg en **info** (sale por stderr del proceso hijo, útil para depurar). |

### Salida

- **`<DIR>/samples/`** — Durante el run se escriben `sample_XXX.png` y luego se **borran** al finalizar.
- **`<DIR>/logos/`** — Recorte y preview con bbox (ver estrategia anterior).
- **`<DIR>/logos.json`** — Incluye `num_samples`, `timeline_sample_interval_fraction` (si aplica), `timeline_bin_width_fraction`, `sample_percent` (solo si usaste el flag), etc.

**stdout:** una línea con la ruta absoluta o relativa de **`logos.json`** (según cómo se pasó `--output-dir`).

### Ejemplo

```bash
cd backend/utils/logo-detector-features

make

./logo_detector \
  'https://ejemplo.cdn/live/channel.m3u8' \
  --channel tvj

./logo_detector \
  --channel tvj \
  --output-dir ./mi_salida \
  --sample-percent 2 \
  'https://ejemplo.cdn/live/channel.m3u8'
```

Con `--sample-percent 2` se piden ~**50** fotogramas en lugar de 100.

---

## 2. Template matching — `logo-template-matching/template_match`

**Binario:** `./template_match` (compilar en esa carpeta).

**Requisito previo:** debe existir al menos un par de export **compatible** (`*.json` con `bbox_frame_xywh`, `reference_frame_wh`, `png_filename` + PNG) en `--logos-dir`. Ese formato corresponde al **detector legacy**; el **`logo_detector` actual (OpenCV)** no lo produce (ver nota arriba).

### Estrategia

Toma el **último** export del canal (por *mtime*): lee el **JSON** del detector (bbox y `reference_frame_wh`) y carga el **PNG** del logo con ffmpeg a **BGR**. Reescala la plantilla al bbox expresado en la resolución del VOD actual y define un **ROI de búsqueda** ampliado con un *padding* porcentual alrededor de ese rectángulo. Resuelve el HLS igual que el detector (master → variante), parsea segmentos (incl. **PROGRAM-DATE-TIME** cuando aplica) y obtiene **WxH** con ffprobe. **Parte la línea de tiempo** en trozos (~120 s) y lanza **varios ffmpeg en paralelo** (pthread): cada uno decodifica su tramo con un filtro **fps** alineado al intervalo de muestreo (p. ej. 1 frame cada 5 s). En cada muestra calcula la mejor **correlación normalizada** estilo **TM_CCOEFF_NORMED** entre plantilla y ROI (implementación en C, sin OpenCV). Sobre la serie binaria logo presente / ausente aplica **histéresis** (N muestras seguidas sin match para abrir una ventana “sin logo”, N con match para cerrarla). Escribe un **JSON** con ventanas, umbrales usados y referencias al export del detector.

### Argumentos

| Argumento | Obligatorio | Descripción |
|-----------|-------------|-------------|
| `<canal>` | **Sí** | Mismo criterio que `--channel` del detector (ej. `tvj`). Se usa para elegir el **último** JSON `tvj-*.json` por fecha de modificación en el directorio de logos. |
| `<m3u8_url>` | **Sí** | Playlist HLS del VOD a analizar (master o media). |
| `-o <archivo.json>` | No | Escribe el resultado en ese archivo. Si **omitís** `-o`, el JSON va a **stdout**. |
| `--logos-dir <DIR>` | No | Carpeta donde están los exports del detector (`*.json` / `*.png`). **Default:** `../logo-detector-features/output/logos` relativo al **directorio de trabajo actual** (`cwd`), no al binario. |

**Orden recomendado:** `./template_match <canal> <m3u8_url> [opciones]`  
(Las opciones `-o` y `--logos-dir` pueden mezclarse; los dos argumentos “sueltos” se asignan en orden: primero → canal, segundo → URL.)

### Parámetros fijos (sin CLI)

Definidos en código; para cambiarlos hay que editar `template_match.c` y recompilar:

- Muestreo: **cada 5 s**  
- Abrir ventana “sin logo”: **5** muestras consecutivas sin match  
- Cerrar ventana: **5** muestras consecutivas con logo  
- Umbral de correlación: **0,72**  
- Trozos de timeline para `ffmpeg` / paralelismo: lógica interna (~120 s por trozo, hasta 512 trozos)

### Ejemplo (ejecutivo)

Desde la carpeta del matcher, con logos por defecto en la ruta relativa esperada:

```bash
cd backend/utils/logo-template-matching

./template_match tvj 'https://ejemplo.cdn/vod/stream.m3u8?startTime=1&endTime=2' -o ./resultado.json
```

Logos en otra ruta:

```bash
./template_match tvj 'https://ejemplo.cdn/vod/stream.m3u8' \
  --logos-dir /ruta/absoluta/a/output/logos \
  -o ./resultado.json
```

Solo stdout (sin `-o`):

```bash
./template_match tvj 'https://ejemplo.cdn/vod/stream.m3u8' | jq .
```

---

## 3. Pipeline típico

1. **Build** del detector (`make` en `logo-detector-features`) y del matcher (`gcc` en `logo-template-matching`).  
2. **`logo_detector`** con el `m3u8` y `--channel` → revisá **`logos.json`** y las muestras en **`samples/`**.  
3. **`template_match`** solo si tenés un export **compatible** (JSON + PNG en el formato que el matcher lee); con el detector OpenCV actual puede ser necesario **generar la plantilla por otro medio** o **adaptar** el matcher / el JSON de salida.  
4. Ingestar los JSON en tu backend si aplica (la API actual no lo hace sola).

---

## 4. Changelog

| Fecha | Cambio |
|------|--------|
| 2026-03-28 | Detector reemplazado por **`logo_detector.cpp`**: OpenCV, muestreo paralelo, ventanas 100×100, clustering por coseno, salida **`logos.json`** + **`samples/`**. Eliminado el fuente C monolítico legacy. |
| 2026-03-28 | Eliminada la implementación Python; documentación histórica refería solo C. |
