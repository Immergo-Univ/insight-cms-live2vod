# Integración Live2VOD nuevo ↔ insight-api ↔ immergo encoder

Describe cómo el BFF (`insight-cms-live2vod/backend`) crea el VOD en Mongo de insight-api (como el legacy) y despacha el encode a `immergo-vod-encoder-api`, que produce HLS multi-rendición + `master.m3u8` y notifica el avance a insight-api y al BFF.

Ver los contratos legacy completos en `insight-api/LIVE2VOD-CONTRACTS.md` (mismo doc en `insight-cms`).

## Flujo

```mermaid
sequenceDiagram
  participant BFF as live2vod backend
  participant API as insight-api (Mongo vods)
  participant Enc as immergo-vod-encoder-api
  participant Agent as immergo agent (k8s)
  BFF->>API: 1) POST cms/entity/vods/insertOrUpdate (base) -> {guid,_id}
  BFF->>API: 2) POST cms/entity/vods/insertOrUpdate (_id + content[] por guid)
  BFF->>Enc: POST /encoder/jobs { jobId, tenantId, spec, s3, vodGuid, insightWebhook }
  Enc->>Agent: k8s Job (FFMPEG_PARAMS con vodGuid)
  Agent->>Enc: PUT /episodes (running/finish + percent, videoDuration)
  Enc->>API: POST cms/pentity/{tenant}/vods/webhook (media_id=guid)
  Enc->>BFF: PATCH /api/encoder/jobs/:jobId (progreso -> WebSocket)
```

## Creación del VOD (BFF → insight-api)

`backend/src/services/insight-vod.service.js` → `createInsightVod({ accountId, tenantId, spec, s3 })`:

1. `POST {INSIGHT_API_BASE}/cms/entity/vods/insertOrUpdate` con el doc base (`title`, `description`, `keywords`, `accountId`, `publish_status:"pending"`, `vodType:"clip"`, poster en `content[]` si el editor lo provee). Headers: `Authorization: Bearer {token}`, `x-tenant-id: {tenant}`. La respuesta trae `guid` y `_id`.
2. Calcula `content[]` con el `guid` y el layout S3 canónico (ver abajo) y hace un segundo `insertOrUpdate` con `_id` para persistir `content[]`.
3. Devuelve `{ vodId, guid }`.

> Se usa `insertOrUpdate` (no `createClip`) para NO disparar el transcoding interno de insight-api. El encode lo hace immergo.

## Layout S3 canónico (compartido BFF ↔ agent)

`backend/src/services/vod-output-layout.js` centraliza prefijo + ladder de renditions y debe coincidir con `immergo-vod-encoder-api/src/config/editorial.config.js`.

```
base   = {cdnBase}/{prefix}/{tenant}/{guid}
master = {base}/hls/master.m3u8        (content hls, default:true)
mp4    = {base}/{guid}.mp4             (content mp4, syndication)
poster = {base}/poster.jpg            (content Poster H)
```

- `prefix` por defecto `generated-vods` (env `EDITORIAL_S3_PREFIX` / `VOD_OUTPUT_PREFIX`).
- `cdnBase` viene de `resolveTenantS3()` (`accountSettings.storageProviders[].distributionUrl`).
- `guid` es la clave compartida: `media_id` del webhook legacy, prefijo S3 y base de las URLs de `content[]`.

Nota: immergo produce **HLS ABR (master + variantes) + un único MP4** de syndication (no un MP4 por rendición como el legacy). Por eso `content[]` lista el `hls` master (default) y un `mp4`.

## Payload a `POST /encoder/jobs`

`backend/src/services/vod-encode-runner.service.js`:

```jsonc
{
  "jobId": "uuid",
  "tenantId": "tenant",
  "spec": { /* EditorStateJson */ },
  "editorClipId": "opcional",
  "s3": { "bucket", "key", "secret", "hostname", "cdnBase", "prefix" },
  "vodGuid": "{guid del VOD en Mongo}",
  "insightWebhook": {
    "url": "{INSIGHT_API_BASE}/cms/pentity/{tenant}/vods/webhook",
    "mediaId": "{guid}",
    "headers": { "x-tenant-id": "{tenant}" }
  }
}
```

## Notificación de avance

- El encoder hace `PATCH /api/encoder/jobs/:jobId` al BFF (igual que hoy) → `vod-jobs.store` → WebSocket `/api/ws/vod`.
- El encoder hace `POST {insightWebhook.url}` (contrato legacy, `media_id = guid`) para actualizar el VOD en Mongo (`percent`, `publish_status`, `video_duration`). Así insight-cms muestra el avance como en legacy.
