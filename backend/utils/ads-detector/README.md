# Ads Detector (HLS/m3u8) - Documentación de uso

Este binario (`bin/ads_detector`) detecta ventanas de publicidad en un stream **HLS m3u8** analizando la **presencia/ausencia del logo** en una **ROI fija** (una esquina) usando **OpenCV**.

## Ejemplo recomendado

```bash
bin/ads_detector \
  --m3u8 "https://rjrtvjlocal-ioriver-cdn.encoders.immergo.tv/0/streamPlaylist.m3u8?startTime=1771917000&endTime=1771924600" \
  --output backend/utils/ads_output.json \
  --br \
  --interval 30 \
  --threads 30 \
  --outlier \
  --outlier-mode knn \
  --quiet
```

## Qué hace (alto nivel)

### 1) Lectura del playlist m3u8

- Si `--m3u8` es una URL HTTP/HTTPS, descarga el contenido del playlist.
- Parsea los segmentos y calcula una **duración total aproximada**.
- Si existe `#EXT-X-PROGRAM-DATE-TIME`, lo usa para convertir offsets (segundos) a timestamps ISO8601.

### 2) Sampling de frames (pasada “gruesa”)

- Genera timestamps: `0, interval, 2*interval, ...` hasta el final.
- Para cada timestamp hace `seek+read` y extrae una ROI **cuadrada** en la esquina seleccionada:
  - **Lado de la ROI** = `--roi` (default `0.15`) * **ancho del frame**
  - Esquinas: `--tl`, `--tr`, `--bl`, `--br` (**requerido**)
- Calcula un **histograma HSV 8x8x8 (512 bins)** de la ROI.
  - La ROI se reduce internamente a `64x64` para performance.
  - Se aplica una **máscara circular centrada** (para reducir sensibilidad al fondo detrás del logo).

El sampling se hace en **paralelo**:
- Si `--threads 0` (default): usa la cantidad de **cores** disponibles.
- Si `--threads N`: usa exactamente **N** threads.
- Cada thread abre su propio `cv::VideoCapture`.

### 3) Modelo de “logo”

Con las muestras se hace:
- PCA (2D) + KMeans para estimar un cluster de “logo”.
- Se calcula `meanHist` del “logo”.
- Se selecciona un set de **semillas de logo** (filtradas para evitar outliers dentro del cluster).

### 4) Detección de ADs (pasada “gruesa”)

La detección decide por muestra si hay logo o no:

- **Modo default (sin `--outlier`)**: usa distancia Bhattacharyya vs `meanHist` y un umbral entrenado.
- **Modo `--outlier`**: usa una estrategia alternativa para “logo/no-logo”.
  - Recomendado: `--outlier-mode knn` (distancia a semillas de logo).

Luego arma intervalos usando un state-machine temporal:
- Entra a AD si hay `--enter-n` muestras consecutivas “sin logo”
- Sale de AD si hay `--exit-n` muestras consecutivas “con logo”
- Filtra intervalos más cortos que `--min-ad-sec`

### 5) Refinamiento (2da iteración, por cada AD encontrado)

Para refinar el inicio/fin de cada AD:
- **Inicio**: evalúa la ventana `[start-30s, start]`
  - busca el primer instante donde **deja de verse el logo**
- **Fin**: evalúa la ventana `[end-30s, end]`
  - busca el primer instante donde **comienza a verse el logo**

Parámetros fijos:
- Paso de muestreo: **5 segundos**
- Ventana: **30 segundos hacia atrás**

Performance:
- El refine también se ejecuta en **paralelo** con la misma lógica de threads que el training (batch global de probes + buckets por tiempo).

## Parámetros (CLI)

- `--m3u8 <url|path>`: URL o path local del playlist (**requerido**).
- `--output <file>`: path del JSON de salida (default `ads.json`).
- `--interval <sec>`: intervalo de sampling (alias de `--every-sec`). Default `5`.
  - En producción suele usarse `30` para la pasada gruesa.
- `--threads <n>`: cantidad de threads. `0` = auto (cores disponibles).
  - También existe alias `--therads` (por compatibilidad).
- `--roi <pct>`: tamaño del lado de la ROI.
  - Puede ser `0.15` (0..1) o `15` (porcentaje). Default `0.15`.
- `--tl|--tr|--bl|--br`: esquina del logo (**requerido**).
- `--outlier`: habilita estrategia alternativa.
- `--outlier-mode dbscan|lof|knn`: modo de outlier.
  - **Recomendado**: `knn`
  - `dbscan`: DBSCAN en PCA 2D (útil si querés clusterizar en el plano PCA).
  - `lof`: Local Outlier Factor (vecinos/densidad local).
  - `knn`: distancia a semillas de logo (robusto cuando el “no-logo” es “lejos del manifold del logo”).
- `--quiet`: silencia logs de progreso a `stderr`, pero **igual imprime el JSON final por stdout**.
- `--debug`: exporta material de debug a `logos_output/` (relativo al ejecutable).

## Salida JSON (schema)

Campos principales:

- `m3u8`: string original.
- `totalDurationSec`: duración aproximada.
- `process.elapsedMs / process.elapsedSec`: duración total del proceso.
- `training`: parámetros y thresholds entrenados.
- `ads`: lista de intervalos detectados:
  - `startOffsetSec`, `endOffsetSec`
  - `startOffsetHms`, `endOffsetHms` (formato `HH:MM:SS`)
  - `startProgramDateTime`, `endProgramDateTime` (si el m3u8 tiene PDT)
- `debug`: info de debug (si aplica).

## Debug output (`--debug`)

Se crea un directorio `logos_output/` (junto al binario) con, entre otros:
- `samples/` ROIs de todas las muestras
- `logos/` ROIs que el modelo considera “logo”
- plots/CSVs de PCA / DBSCAN / KNN / LOF (según modo)
- `refine_intervals.csv` (coarse vs refined por AD)

> Nota: El repo ignora `logos_output/` vía `.gitignore`.

