import { createServer } from "http";
import { URL } from "url";
import express from "express";
import cors from "cors";
import path from "path";
import { fileURLToPath } from "url";
import { WebSocketServer } from "ws";
import { channelsRouter } from "./controllers/channels.controller.js";
import { channelSettingsRouter } from "./controllers/channel-settings.controller.js";
import { editorPostersRouter } from "./controllers/editor-posters.controller.js";
import { m3u8Router } from "./controllers/m3u8.controller.js";
import { adsRouter } from "./controllers/ads.controller.js";
import { authRouter } from "./controllers/auth.controller.js";
import { vodRouter } from "./controllers/vod.controller.js";
import { publicTranscriptNewsRouter } from "./controllers/public-transcript-news.controller.js";
import { encoderCallbackRouter } from "./controllers/encoder-callback.controller.js";
import { tenantsRouter } from "./controllers/tenants.controller.js";
import { adminRouter } from "./routes/admin.routes.js";
import { config } from "./config.js";
import { startLogoScanScheduler } from "./services/logo-scheduler.service.js";
import { startLogoLiveMatchingService } from "./services/logo-live-matching.service.js";
import { isS3LogosEnabled, logS3LogosStartup } from "./services/s3-logos.service.js";
import { syncAllChannelLogosFromS3, startChannelLogosS3Sync } from "./services/channel-logos-sync.service.js";
import { syncChannelAdsSnapshotsFromS3OnStartup } from "./services/channel-ads-s3-backup.service.js";
import { getResolvedTiktokDomainVerificationFile } from "./services/admin-settings.service.js";
import { resolveTenant } from "./services/auth.service.js";
import { initVodJobsPersistence, subscribeTenant, unsubscribeTenant } from "./services/vod-jobs.store.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = config.port;

app.use(cors());
app.use(express.json({ limit: "12mb" }));

const TIKTOK_FILE_CACHE_MS = 10000;
let tiktokVerificationCache = {
  expiresAt: 0,
  path: "",
  content: "",
  contentType: "text/plain; charset=utf-8",
};

async function readTiktokVerificationCached() {
  const now = Date.now();
  if (tiktokVerificationCache.expiresAt > now) return tiktokVerificationCache;
  try {
    const resolved = await getResolvedTiktokDomainVerificationFile();
    tiktokVerificationCache = {
      expiresAt: now + TIKTOK_FILE_CACHE_MS,
      path: String(resolved.path || "").trim(),
      content: String(resolved.content || ""),
      contentType: String(resolved.contentType || "").trim() || "text/plain; charset=utf-8",
    };
  } catch {
    tiktokVerificationCache = {
      expiresAt: now + TIKTOK_FILE_CACHE_MS,
      path: "",
      content: "",
      contentType: "text/plain; charset=utf-8",
    };
  }
  return tiktokVerificationCache;
}

app.use(async (req, res, next) => {
  if (req.method !== "GET" && req.method !== "HEAD") return next();
  try {
    const resolved = await readTiktokVerificationCached();
    if (resolved.path && resolved.content && req.path === resolved.path) {
      res.setHeader("Content-Type", resolved.contentType);
      if (req.method === "HEAD") return res.status(200).end();
      return res.status(200).send(resolved.content);
    }
  } catch {
    // Keep request flow healthy even if settings read fails.
  }
  next();
});

app.use("/api/auth", authRouter);
app.use("/api/channels", channelSettingsRouter);
app.use("/api/channels", editorPostersRouter);
app.use("/api/channels", channelsRouter);
app.use("/api/m3u8", m3u8Router);
app.use("/api/ads", adsRouter);
app.use("/api/vod", vodRouter);
app.use("/api/tenants", tenantsRouter);
app.use("/api/public", publicTranscriptNewsRouter);
app.use("/api/encoder", encoderCallbackRouter);
app.use("/api/admin", adminRouter);

const frontendBuildPath = path.join(__dirname, "../../frontend/dist");
app.use(express.static(frontendBuildPath));

app.get("/{*splat}", (_req, res) => {
  res.sendFile(path.join(frontendBuildPath, "index.html"));
});

const server = createServer(app);

const vodWss = new WebSocketServer({ noServer: true });

vodWss.on("connection", (ws, req) => {
  let tenantId = "";
  try {
    const u = new URL(req.url || "", `http://${req.headers.host || "localhost"}`);
    tenantId = (u.searchParams.get("tenantId") || "").trim();
  } catch {
    /* ignore */
  }
  if (!tenantId) {
    ws.close(1008, "tenantId required");
    return;
  }
  resolveTenant(tenantId)
    .then(async () => {
      await subscribeTenant(tenantId, ws);
      ws.on("close", () => unsubscribeTenant(tenantId, ws));
      ws.on("error", () => unsubscribeTenant(tenantId, ws));
    })
    .catch(() => {
      ws.close(1008, "invalid tenant");
    });
});

server.on("upgrade", (request, socket, head) => {
  let pathname = "";
  try {
    pathname = new URL(request.url || "", `http://${request.headers.host || "localhost"}`).pathname;
  } catch {
    socket.destroy();
    return;
  }
  if (pathname === "/api/ws/vod") {
    vodWss.handleUpgrade(request, socket, head, (ws) => {
      vodWss.emit("connection", ws, request);
    });
  } else {
    socket.destroy();
  }
});

initVodJobsPersistence()
  .then(() => {
    server.listen(PORT, () => {
      console.log(`Server running on port ${PORT}`);
      if (config.postgres?.enabled) {
        console.log("[vod-jobs] PostgreSQL persistence enabled");
      }
      logS3LogosStartup();
      if (isS3LogosEnabled()) {
        syncChannelAdsSnapshotsFromS3OnStartup().catch((e) => console.warn("[channel-ads-s3] startup:", e.message));
        syncAllChannelLogosFromS3().catch(() => {});
        startChannelLogosS3Sync();
      }
      startLogoScanScheduler();
      startLogoLiveMatchingService();
    });
  })
  .catch((err) => {
    console.error("[vod-jobs] Persistence init failed:", err);
    process.exit(1);
  });
