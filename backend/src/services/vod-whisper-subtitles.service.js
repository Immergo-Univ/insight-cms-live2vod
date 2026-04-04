/**
 * Transcribe final MP4 with whisper.cpp and burn subtitles (styled) into the video.
 */

import { execFileSync, spawn } from "child_process";
import { accessSync } from "fs";
import fs from "fs/promises";
import path from "path";

function pathExistsSync(p) {
  try {
    accessSync(p);
    return true;
  } catch {
    return false;
  }
}

/** @returns {string | null} */
function whisperCliFromShellPath() {
  try {
    const out = execFileSync("/bin/sh", ["-c", "command -v whisper-cli 2>/dev/null"], {
      encoding: "utf8",
      maxBuffer: 4096,
    }).trim();
    return out && pathExistsSync(out) ? out : null;
  } catch {
    return null;
  }
}

/**
 * @returns {string}
 */
function resolveWhisperCliPath() {
  const envPath = process.env.WHISPER_CLI_PATH?.trim();
  if (envPath) {
    if (!pathExistsSync(envPath)) {
      throw new Error(
        `WHISPER_CLI_PATH points to missing file: ${envPath}. Fix the path or unset it to use whisper-cli on PATH.`,
      );
    }
    return envPath;
  }
  const fromPath = whisperCliFromShellPath();
  if (fromPath) return fromPath;
  const dockerPath = "/opt/whisper/whisper-cli";
  if (pathExistsSync(dockerPath)) return dockerPath;
  throw new Error(
    "whisper-cli not found. Options: (1) Add whisper-cli to PATH (build whisper.cpp), (2) set WHISPER_CLI_PATH to the binary, or (3) run the backend in Docker where /opt/whisper is preinstalled.",
  );
}

/**
 * @returns {string}
 */
function resolveWhisperModelPath() {
  const envPath = process.env.WHISPER_MODEL_PATH?.trim();
  if (envPath) {
    if (!pathExistsSync(envPath)) {
      throw new Error(
        `WHISPER_MODEL_PATH points to missing file: ${envPath}. Download a ggml model (e.g. whisper.cpp models/download-ggml-model.sh base).`,
      );
    }
    return envPath;
  }
  const dockerPath = "/opt/whisper/models/ggml-base.bin";
  if (pathExistsSync(dockerPath)) return dockerPath;
  const home = process.env.HOME?.trim() || "";
  const candidates = [
    path.join(home, "whisper.cpp/models/ggml-base.bin"),
    path.join(process.cwd(), "models/ggml-base.bin"),
    path.join(process.cwd(), "whisper.cpp/models/ggml-base.bin"),
  ];
  for (const c of candidates) {
    if (c && pathExistsSync(c)) return c;
  }
  throw new Error(
    "Whisper GGML model not found (ggml-base.bin). Set WHISPER_MODEL_PATH to the .bin file, or run whisper.cpp models/download-ggml-model.sh base (see Dockerfile).",
  );
}

/**
 * @param {string} hex
 * @returns {string} ASS BGR color &H00BBGGRR
 */
function hexToAssColor(hex) {
  const h = String(hex || "")
    .replace("#", "")
    .trim();
  if (!/^[0-9a-fA-F]{6}$/.test(h)) return "&H00FFFFFF";
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  const pad = (n) => n.toString(16).padStart(2, "0");
  return `&H00${pad(b)}${pad(g)}${pad(r)}`;
}

/**
 * Escape path for ffmpeg subtitles filter (libavfilter).
 * @param {string} p
 */
function escapeSubtitlesPath(p) {
  return p.replace(/\\/g, "\\\\").replace(/:/g, "\\:").replace(/'/g, "\\'");
}

/**
 * @param {string[]} args
 * @param {() => boolean} shouldCancel
 */
function runProc(cmd, args, shouldCancel) {
  return new Promise((resolve, reject) => {
    if (shouldCancel()) {
      reject(new Error("CANCELLED"));
      return;
    }
    const proc = spawn(cmd, args, { stdio: ["ignore", "ignore", "pipe"] });
    let stderr = "";
    proc.stderr?.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    const check = setInterval(() => {
      if (shouldCancel()) {
        clearInterval(check);
        proc.kill("SIGKILL");
      }
    }, 400);
    proc.on("error", (err) => {
      clearInterval(check);
      if (/** @type {NodeJS.ErrnoException} */ (err).code === "ENOENT") {
        reject(new Error(`${cmd} not found on PATH`));
        return;
      }
      reject(err);
    });
    proc.on("close", (code) => {
      clearInterval(check);
      if (shouldCancel()) {
        reject(new Error("CANCELLED"));
        return;
      }
      if (code === 0) resolve();
      else {
        const tail = stderr.trim() || "(no stderr output)";
        const label = path.basename(cmd);
        console.error(`[vod][${label}] exit=${code}`, tail.length > 4000 ? `${tail.slice(0, 4000)}…` : tail);
        reject(new Error(tail.length > 800 ? `${tail.slice(0, 800)}…` : tail || `${label} exited with code ${code}`));
      }
    });
  });
}

/**
 * @param {object} opts
 * @param {string} opts.inputMp4
 * @param {string} opts.wavPath
 * @param {() => boolean} opts.shouldCancel
 */
async function extractAudioWav16k(opts) {
  const { inputMp4, wavPath, shouldCancel } = opts;
  await runProc(
    "ffmpeg",
    [
      "-hide_banner",
      "-loglevel",
      "error",
      "-y",
      "-i",
      inputMp4,
      "-ar",
      "16000",
      "-ac",
      "1",
      "-c:a",
      "pcm_s16le",
      wavPath,
    ],
    shouldCancel,
  );
}

/**
 * @param {object} opts
 * @param {string} opts.whisperCli
 * @param {string} opts.modelPath
 * @param {string} opts.wavPath
 * @param {string} opts.srtBase path without extension (whisper adds .srt)
 * @param {() => boolean} opts.shouldCancel
 */
async function runWhisperCli(opts) {
  const { whisperCli, modelPath, wavPath, srtBase, shouldCancel } = opts;
  await runProc(
    whisperCli,
    [
      "-m",
      modelPath,
      "-f",
      wavPath,
      "-l",
      "auto",
      "-osrt",
      "-of",
      srtBase,
      "-np",
    ],
    shouldCancel,
  );
}

/**
 * @param {object} opts
 * @param {string} opts.inputMp4
 * @param {string} opts.vf
 * @param {string} opts.outputMp4
 * @param {() => boolean} opts.shouldCancel
 */
async function burnSubtitlesFfmpeg(opts) {
  const { inputMp4, vf, outputMp4, shouldCancel } = opts;
  await runProc(
    "ffmpeg",
    [
      "-hide_banner",
      "-loglevel",
      "error",
      "-y",
      "-i",
      inputMp4,
      "-vf",
      vf,
      "-c:v",
      "libx264",
      "-preset",
      "ultrafast",
      "-profile:v",
      "high",
      "-pix_fmt",
      "yuv420p",
      "-c:a",
      "copy",
      "-movflags",
      "+faststart",
      outputMp4,
    ],
    shouldCancel,
  );
}

/**
 * @typedef {object} SubtitleBurnStyle
 * @property {number} [fontSizePx]
 * @property {string} [textColor] hex #RRGGBB
 * @property {string} [outlineColor] hex #RRGGBB
 * @property {number} [outlineWidthPx]
 */

/**
 * After the main encode, transcribe and burn subtitles into a new MP4.
 *
 * @param {object} ctx
 * @param {string} ctx.inputMp4
 * @param {string} ctx.workDir
 * @param {SubtitleBurnStyle} ctx.style
 * @param {() => boolean} ctx.shouldCancel
 * @param {(pct: number) => void} [ctx.onProgress]
 * @returns {Promise<{ localPath: string }>}
 */
export async function transcribeAndBurnSubtitles(ctx) {
  const { inputMp4, workDir, style, shouldCancel, onProgress } = ctx;

  const whisperCli = resolveWhisperCliPath();
  const modelPath = resolveWhisperModelPath();

  const wavPath = path.join(workDir, "whisper_input.wav");
  const srtBase = path.join(workDir, "whisper_subs");
  const srtPath = `${srtBase}.srt`;
  const outPath = path.join(workDir, "output_subtitled.mp4");

  onProgress?.(52);
  await extractAudioWav16k({ inputMp4, wavPath, shouldCancel });

  onProgress?.(56);
  await runWhisperCli({
    whisperCli,
    modelPath,
    wavPath,
    srtBase,
    shouldCancel,
  });

  onProgress?.(72);
  try {
    await fs.access(srtPath);
  } catch {
    throw new Error("Whisper did not produce an SRT file");
  }

  const fontSize = Math.max(8, Math.min(120, Number(style?.fontSizePx) || 28));
  const outlineW = Math.max(0, Math.min(20, Number(style?.outlineWidthPx) || 3));
  const primary = hexToAssColor(style?.textColor);
  const outlineCol = hexToAssColor(style?.outlineColor);

  const fontName = (process.env.VOD_SUBTITLE_FONT_NAME || "DejaVu Sans").trim();
  const forceStyle = `Fontname=${fontName},FontSize=${fontSize},PrimaryColour=${primary},OutlineColour=${outlineCol},Outline=${outlineW},Shadow=0,MarginV=48,Alignment=2,Bold=1`;

  const subsEscaped = escapeSubtitlesPath(srtPath);
  const vf = `subtitles='${subsEscaped}':force_style='${forceStyle}'`;

  onProgress?.(76);
  await burnSubtitlesFfmpeg({ inputMp4, vf, outputMp4: outPath, shouldCancel });

  onProgress?.(88);
  return { localPath: outPath };
}
