# Vistas embebibles (iframe en el CMS Angular legacy)

Este documento lista las URLs de cada vista standalone de `insight-cms-live2vod`
que se embebe dentro del CMS Angular legacy (`insight-cms`) vía `<iframe>`.

## Base URL

La base se resuelve en este orden (en el componente Angular que arma el iframe):

1. `item.layoutType.details.url` (override por configuración de entidad), o
2. `environment.newLive2vodUrl` (fallback global).

Valor actual en todos los entornos (`environment.ts`, `environment.staging.ts`,
`environment.prod.ts`):

```
https://insight-cms-live2vod-id2z9.ondigitalocean.app
```

En desarrollo local, la base suele ser el dev server de Vite:

```
http://localhost:5173
```

> En los ejemplos de abajo se usa `{BASE}` para representar la base URL.

## Parámetro `tenantId`

Todas las vistas requieren `tenantId` como query param. Viaja **cifrado** (AES
CryptoJS, el mismo cifrado que usa BI/analytics, obtenido de
`cms/entity/entityTypes/getClient`). Si el cifrado falla, el CMS cae a enviar el
**código de tenant en texto plano** como fallback. La app live2vod resuelve
ambos casos.

Parámetro opcional común:

- `tz`: timezone IANA (ej. `America/Argentina/Buenos_Aires`). Si no se envía, se
  usa el default de la app.

## Vistas

| Vista | Ruta | Query params | Componente legacy que la embebe |
|-------|------|--------------|---------------------------------|
| Live2VOD (dashboard principal) | `/` | `tenantId` (req), `tz` (opt) | `app-new-live2vod` (`NewLive2vodComponent`) |
| Editor Live2VOD (clipping con marcadores de ADs) | `/editor` | `tenantId` (req), `tz` (opt) | navegación interna desde `/` |
| VOD Editor (clipping sin ADs, sobre un VOD existente) | `/vod-editor` | `tenantId` (req), `src` (req), `tz` (opt) | `app-vod-editor-iframe` (`VodEditorIframeComponent`) |
| VOD por GUID (AI Content: "AI on this clip") | `/vod/:vod_guid` | `tenantId` (req) en query; `:vod_guid` en path; `lang` (opt, `en`/`es`) | — (acceso directo / deep link) |
| Processing Clips (estado de encodes) | `/processing-clips` | `tenantId` (req), `tz` (opt) | navegación interna |
| Social Media (sindicación) | `/social-media` | `tenantId` (req), `tz` (opt) | vista nueva (ver `docs/syndication_new_design.md`) |

> La consola de administración vive en `/admin/*` pero es una app standalone
> aparte (no es una vista embebida por entidad), por eso no se lista arriba.

### AI Content (`/vod/:vod_guid`) y órdenes de créditos

- Speech-to-text y News article se ejecutan sobre el VOD existente
  (`POST /api/vod/by-guid/:vodGuid/ai-runs`); el resultado se mergea en Insight al completar.
  Subtitles y Audio dubbing muestran resultados existentes (Run "Coming soon").
- "Buy credits" crea una **orden de compra pendiente** (`POST /api/ai-credits/orders`).
  Los créditos se otorgan solo cuando un admin la aprueba en `/admin/credit-orders`
  (permiso `credits.*`).
- Variables de entorno opcionales (backend): `CREDIT_PACKS_JSON`, `CREDIT_SALE_USD_VALUE`
  (default `0.005`), `CREDIT_CUSTOM_MIN` (default `20000`), `CREDIT_SALES_EMAIL`.

### Detalle del parámetro `src` (solo `/vod-editor`)

JSON codificado en base64 (unicode-safe) con los assets de origen del VOD:

```json
{ "hls": "<url hls>", "mp4": ["<url mp4>", "..."], "posters": ["<url poster>", "..."] }
```

Se arma a partir del `content` de la entidad (assets con `assetTypes` `hls`,
`mp4`, `Poster H`) y se envía en texto plano (sin cifrar).

## Ejemplos de URL

```
# Live2VOD (dashboard)
{BASE}/?tenantId=<tenantIdCifrado>

# Editor Live2VOD
{BASE}/editor?tenantId=<tenantIdCifrado>&tz=America/Argentina/Buenos_Aires

# VOD Editor
{BASE}/vod-editor?tenantId=<tenantIdCifrado>&src=<base64JSON>

# VOD por GUID
{BASE}/vod/<vod_guid>?tenantId=<tenantIdCifrado>

# Processing Clips
{BASE}/processing-clips?tenantId=<tenantIdCifrado>

# Social Media (sindicación)
{BASE}/social-media?tenantId=<tenantIdCifrado>
```

## Query params de retorno de OAuth (sindicación)

Al volver de un OAuth de redes sociales, el backend redirige al frontend con
flags que `TenantSettingsProvider` lee y luego limpia de la URL (aplican a
`/editor` y a `/social-media`):

- `youtubeConnected`, `twitterConnected`, `facebookConnected`,
  `instagramConnected`, `tiktokConnected` = `1`
- `facebookPending`, `instagramPending` = `1` (falta elegir Page / cuenta)
- `youtubeDuplicate`, `twitterDuplicate`, `facebookDuplicate`,
  `instagramDuplicate`, `tiktokDuplicate` = `1`
- `accountId` = `<id de la cuenta recién autorizada>`
