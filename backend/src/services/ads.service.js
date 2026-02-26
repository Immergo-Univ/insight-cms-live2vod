import { execSync, execFile } from "child_process";
import { promisify } from "util";
import path from "path";
import { fileURLToPath } from "url";

const execFileAsync = promisify(execFile);

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ADS_DETECTOR_BIN = path.resolve(__dirname, "../../utils/bin/ads_detector");

function buildArgs({ m3u8Url, corner = "br", debug = true }) {
  return [
    "--m3u8", m3u8Url,
    `--${corner}`,
    "--interval", "30",
    "--tokayo",
    ...(debug ? ["--debug"] : []),
  ];
}

export function detectAds({ m3u8Url, corner = "br" }) {
  const args = buildArgs({ m3u8Url, corner, debug: true });

  console.log(`[ads-detector] Binary: ${ADS_DETECTOR_BIN}`);
  console.log(`[ads-detector] Arguments:`, args);

  const cmd = [ADS_DETECTOR_BIN, ...args.map((a) => (a.includes(" ") || a.includes("?") || a.includes("&") ? `'${a}'` : a))].join(" ");

  const stdout = execSync(cmd, {
    encoding: "utf-8",
    timeout: 300_000,
    maxBuffer: 10 * 1024 * 1024,
    stdio: ["pipe", "pipe", "inherit"],
  });

  return JSON.parse(stdout);
}

/**
 * Non-blocking version used by the prewarm process so the server
 * can keep handling requests while pre-warming runs in background.
 */
export async function detectAdsAsync({ m3u8Url, corner = "br" }) {
  const args = buildArgs({ m3u8Url, corner, debug: false });

  const { stdout } = await execFileAsync(ADS_DETECTOR_BIN, args, {
    encoding: "utf-8",
    timeout: 300_000,
    maxBuffer: 10 * 1024 * 1024,
  });

  return JSON.parse(stdout);
}
