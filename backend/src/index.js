import express from "express";
import cors from "cors";
import path from "path";
import { fileURLToPath } from "url";
import { channelsRouter } from "./controllers/channels.controller.js";
import { m3u8Router } from "./controllers/m3u8.controller.js";
import { adsRouter } from "./controllers/ads.controller.js";
import { config } from "./config.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = config.port;

app.use(cors());
app.use(express.json());

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
});
