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
import { encoderCallbackRouter } from "./controllers/encoder-callback.controller.js";
import { config } from "./config.js";
import { startLogoScanScheduler } from "./services/logo-scheduler.service.js";
import { startLogoLiveMatchingService } from "./services/logo-live-matching.service.js";
import { isS3LogosEnabled, logS3LogosStartup } from "./services/s3-logos.service.js";
import { syncAllChannelLogosFromS3, startChannelLogosS3Sync } from "./services/channel-logos-sync.service.js";
import { syncChannelAdsSnapshotsFromS3OnStartup } from "./services/channel-ads-s3-backup.service.js";
import { resolveTenant } from "./services/auth.service.js";
import { subscribeTenant, unsubscribeTenant } from "./services/vod-jobs.store.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = config.port;

app.use(cors());
app.use(express.json());

app.use("/api/auth", authRouter);
app.use("/api/channels", channelSettingsRouter);
app.use("/api/channels", editorPostersRouter);
app.use("/api/channels", channelsRouter);
app.use("/api/m3u8", m3u8Router);
app.use("/api/ads", adsRouter);
app.use("/api/vod", vodRouter);
app.use("/api/encoder", encoderCallbackRouter);

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
    .then(() => {
      subscribeTenant(tenantId, ws);
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

server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
  logS3LogosStartup();
  if (isS3LogosEnabled()) {
    syncChannelAdsSnapshotsFromS3OnStartup().catch((e) => console.warn("[channel-ads-s3] startup:", e.message));
    syncAllChannelLogosFromS3().catch(() => {});
    startChannelLogosS3Sync();
  }
  startLogoScanScheduler();
  startLogoLiveMatchingService();
});
