import express from "express";
import cors from "cors";
import path from "path";
import { fileURLToPath } from "url";
import { channelsRouter } from "./controllers/channels.controller.js";
import { channelSettingsRouter } from "./controllers/channel-settings.controller.js";
import { m3u8Router } from "./controllers/m3u8.controller.js";
import { adsRouter } from "./controllers/ads.controller.js";
import { authRouter } from "./controllers/auth.controller.js";
import { config } from "./config.js";
import { startLogoScanScheduler } from "./services/logo-scheduler.service.js";
import { startLogoLiveMatchingService } from "./services/logo-live-matching.service.js";
import { isS3LogosEnabled, logS3LogosStartup } from "./services/s3-logos.service.js";
import { syncAllChannelLogosFromS3, startChannelLogosS3Sync } from "./services/channel-logos-sync.service.js";
import { syncChannelAdsSnapshotsFromS3OnStartup } from "./services/channel-ads-s3-backup.service.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = config.port;

app.use(cors());
app.use(express.json());

app.use("/api/auth", authRouter);
app.use("/api/channels", channelSettingsRouter);
app.use("/api/channels", channelsRouter);
app.use("/api/m3u8", m3u8Router);
app.use("/api/ads", adsRouter);

const frontendBuildPath = path.join(__dirname, "../../frontend/dist");
app.use(express.static(frontendBuildPath));

app.get("/{*splat}", (_req, res) => {
  res.sendFile(path.join(frontendBuildPath, "index.html"));
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
  logS3LogosStartup();
  if (isS3LogosEnabled()) {
    syncChannelAdsSnapshotsFromS3OnStartup().catch((e) => console.warn("[channel-ads-s3] startup:", e.message));
    syncAllChannelLogosFromS3().catch((e) => console.warn("[channel-logos-sync] startup:", e.message));
    startChannelLogosS3Sync();
  }
  startLogoScanScheduler();
  startLogoLiveMatchingService();
});
