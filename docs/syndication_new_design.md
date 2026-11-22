# Social Media (Syndication) – New embedded view

Nueva vista central (componente "main") que se embebe en el CMS Angular legacy, al
igual que las vistas de editor y VOD. Muestra y configura las cuentas de redes
sociales disponibles para el tenant (solo las plataformas habilitadas por admin).

- Ruta frontend: `/social-media?tenantId=<id>` (registrada en `src/main.tsx`).
- Solo arma la page central; el topnav y el sidebar los aporta el CMS legacy.
- Los defaults por cuenta se guardan en backend (ver pendiente 1, ya implementado).

## Archivos agregados (frontend)

- `src/pages/syndication-settings.tsx` — página principal (lista de cuentas +
  panel de detalle + footer de guardado).
- `src/components/syndication/syndication-settings-model.tsx` — metadata de
  plataformas y definición de las cards/campos de configuración por defecto.
- `src/components/syndication/syndication-field-control.tsx` — renderizador de
  campos (info / select / segment / toggle / text / textarea / chips).
- `src/components/syndication/syndication-connect-modal.tsx` — modal "Connect
  account" (elegir plataforma + permisos OAuth + CTA).
- `src/components/syndication/syndication-select-target-modal.tsx` — selector de
  Facebook Page / cuenta de Instagram cuando queda pendiente de selección.
## Qué ya funciona con el backend actual

Reutiliza `src/services/tenant-syndication.service.ts` y sus endpoints:

- Listar estado y cuentas conectadas por plataforma (`GET /api/tenants/:id/syndication`).
- Iniciar OAuth / reconectar por plataforma (`.../<red>/auth-url`).
- Mock authorize en entornos dev (`.../<red>/mock-authorize`).
- Facebook: listar Pages y seleccionar Page (`.../facebook/pages`, `.../facebook/select-page`).
- Instagram: listar cuentas y seleccionar cuenta business (`.../instagram/accounts`, `.../instagram/select-account`).
- Límites de cuentas por plataforma (ya expuestos en el status).

Plataformas soportadas (según backend): YouTube, Facebook, Instagram, X (Twitter) y
TikTok. Solo se muestran las habilitadas por admin para el tenant
(`syndication<Red>Enabled` en el `TenantDto`).

## Pendientes de backend (requeridos para completar el diseño)

Estos puntos del diseño NO tienen soporte backend hoy. En la UI quedan como
controles deshabilitados, acciones con aviso, o persistencia local temporal.

1. **Defaults de posteo por cuenta — implementado.**
   Se guardan en `tenant_syndication_accounts.settings` (JSONB) vía
   `GET/PUT /api/tenants/:id/syndication/:platform/accounts/:accountId/settings`.
   Los runners combinan esos defaults con lo que el editor guarde por clip (el clip
   gana solo si guardó el campo). El formulario solo muestra campos que la API de
   cada red recibe:
   - YouTube: visibility, category, audience, idioma, license, notify, embed,
     estadísticas públicas, título/descripción/tags.
   - Facebook: título, descripción, hashtags.
   - Instagram: Reel o feed, "share to feed" de Reels, caption, hashtags.
   - X: quién puede responder (`reply_settings`), texto, hashtags.
   - TikTok: privacidad, comentarios/Duet/Stitch, disclosure, etiqueta de IA
     (`is_aigc`), caption, hashtags.
   Se quitaron General, Video e imagen, link/UTM, playlist, comentarios de YouTube,
   Shorts, países/edad/crosspost de Facebook, Stories/colaboradores/ubicación de
   Instagram, hilos/link en reply/contenido sensible de X y borradores de TikTok:
   el upload actual no los envía.

2. **Desconectar / eliminar una cuenta conectada.**
   No hay endpoint de disconnect/remove. El botón "Disconnect" está deshabilitado.
   Falta, por ejemplo: `DELETE /api/tenants/:id/syndication/:platform/accounts/:accountId`.

3. **"Send test post" (publicación de prueba).**
   No existe endpoint. El botón está deshabilitado. Falta, por ejemplo:
   `POST /api/tenants/:id/syndication/:platform/accounts/:accountId/test-post`.

4. **Metadatos de estado enriquecido por cuenta.**
   El diseño muestra "Connected as @…", "Last post …" y estados "Login expires in N
   days" / "Reconnect needed". El status actual solo expone `active` /
   `pending_selection`. Faltan en la respuesta de status: `connectedAs`,
   `lastPostAt`, y un `health`/`expiresAt` para los banners de reconexión.

5. **Display name, idioma y grupos que pueden postear.**
   Quitados del formulario. Requieren persistencia propia y un catálogo de user
   groups del tenant.

6. **YouTube: "Add to playlist".**
   Quitado del formulario. Necesita listar las playlists del canal
   (`playlists.list`) y una llamada extra `playlistItems.insert` después del upload,
   además del scope OAuth `youtube` (hoy solo se pide `youtube.upload`).

## Fuera de alcance (del mockup original)

- **Brightcove** y **WeTransfer**: aparecen en el diseño original pero no existen
  en el backend de syndication. Se omitieron. Si se agregan al backend, extender
  `SYNDICATION_PLATFORM_*` en `syndication-settings-model.tsx` y los mapas de
  `auth-url` / `mock-authorize` en `syndication-settings.tsx`.
- **Merge "Facebook + Instagram" en una sola conexión**: el backend las maneja
  como plataformas separadas, así que se muestran por separado. Si se unifica el
  flujo OAuth, adaptar el modal de conexión y la selección de pages/cuentas.
