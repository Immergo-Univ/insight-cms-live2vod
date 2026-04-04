/**
 * Transcribe final MP4 with whisper.cpp and burn subtitles (styled) into the video.
 */

import { spawn } from "child_process";
import fs from "fs/promises";
import path from "path";

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
      else reject(new Error(stderr.trim() || `${cmd} exited with code ${code}`));
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

  const whisperCli = (process.env.WHISPER_CLI_PATH || "/opt/whisper/whisper-cli").trim();
  const modelPath = (process.env.WHISPER_MODEL_PATH || "/opt/whisper/models/ggml-base.bin").trim();

  try {
    await fs.access(whisperCli);
  } catch {
    throw new Error(
      `whisper-cli not found at ${whisperCli}. Set WHISPER_CLI_PATH or install whisper.cpp (see Dockerfile).`,
    );
  }
  try {
    await fs.access(modelPath);
  } catch {
    throw new Error(
      `Whisper model missing at ${modelPath}. Set WHISPER_MODEL_PATH or add ggml-base.bin under /opt/whisper/models/.`,
    );
  }

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
