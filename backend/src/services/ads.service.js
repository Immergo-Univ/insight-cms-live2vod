import { execSync } from "child_process";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ADS_DETECTOR_BIN = path.resolve(__dirname, "../../utils/bin/ads_detector");

export function detectAds({ m3u8Url, corner = "br" }) {
  const cornerFlag = `--${corner}`;

  const cmd = [
    ADS_DETECTOR_BIN,
    "--m3u8", `'${m3u8Url}'`,
    cornerFlag,
    "--interval", "30",
    "--threads", "30",
    "--outlier",
    "--outlier-mode", "knn",
    "--quiet",
    "--output", "/dev/null",
  ].join(" ");

  const stdout = execSync(cmd, {
    encoding: "utf-8",
    timeout: 300_000,
    maxBuffer: 10 * 1024 * 1024,
  });

  return JSON.parse(stdout);
}
