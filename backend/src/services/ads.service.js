import { execSync } from "child_process";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ADS_DETECTOR_BIN = path.resolve(__dirname, "../../utils/bin/ads_detector");

export function detectAds({ m3u8Url, corner = "br" }) {
  const cornerFlag = `--${corner}`;

  const args = [
    "--m3u8", m3u8Url,
    cornerFlag,
    "--interval", "30",
    "--tokayo",
    "--debug",
    "--output", "/dev/null",
  ];

  console.log(`[ads-detector] Binary: ${ADS_DETECTOR_BIN}`);
  console.log(`[ads-detector] Arguments:`, args);

  const cmd = [ADS_DETECTOR_BIN, ...args.map((a) => (a.includes(" ") || a.includes("?") || a.includes("&") ? `'${a}'` : a))].join(" ");

  const stdout = execSync(cmd, {
    encoding: "utf-8",
    timeout: 300_000,
    maxBuffer: 10 * 1024 * 1024,
  });

  return JSON.parse(stdout);
}
