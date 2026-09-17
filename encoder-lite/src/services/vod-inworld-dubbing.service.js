/**
 * Inworld AI dubbing: clone per-speaker voices, translate cues, TTS at natural rate, mux multi-audio MP4.
 */

import fs from "fs/promises";
import { spawn } from "child_process";
import path from "path";
import { config } from "../config.js";
import { ffprobeDurationSec } from "./vod-openai-audio-stt.service.js";
import { spawnFailureMessage } from "../utils/spawn-failure-message.js";

const CLONE_TARGET_SEC = 12;
const CLONE_MIN_SEC = 3;

/** HTTP statuses worth retrying (rate limit + transient upstream errors). */
const INWORLD_RETRY_STATUSES = new Set([429, 500, 502, 503, 504]);
/** Max retry attempts for voice clone (Inworld free plan: 2 clone requests / minute). */
const CLONE_MAX_RETRIES = 5;
/** Base wait after a 429 when no Retry-After header is provided. */
const RATE_LIMIT_BASE_WAIT_MS = 32_000;
/** Upper bound for any single backoff wait. */
const RETRY_MAX_WAIT_MS = 90_000;

/**
 * @param {string[]} args
 * @param {() => boolean} [shouldCancel]
 */
function runFfmpeg(args, shouldCancel = () => false) {
  return new Promise((resolve, reject) => {
    if (shouldCancel()) {
      reject(new Error("CANCELLED"));
      return;
    }
    const proc = spawn("ffmpeg", args, { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    proc.stdout?.on("data", (c) => {
      stdout += c.toString();
    });
    proc.stderr?.on("data", (c) => {
      stderr += c.toString();
    });
    const check = setInterval(() => {
      if (shouldCancel()) {
        clearInterval(check);
        proc.kill("SIGKILL");
      }
    }, 400);
    proc.on("error", (err) => {
      clearInterval(check);
      reject(err);
    });
    proc.on("close", (code, signal) => {
      clearInterval(check);
      if (shouldCancel()) {
        reject(new Error("CANCELLED"));
        return;
      }
      if (code === 0) resolve({ stdout, stderr });
      else {
        reject(
          new Error(
            spawnFailureMessage({
              commandLabel: "ffmpeg",
              code: code ?? null,
              signal: signal ?? null,
              stderr: stderr + stdout,
            }),
          ),
        );
      }
    });
  });
}

function requireInworldKey() {
  if (!config.inworldApiKey) {
    throw new Error("INWORLD_API_KEY is required for AI dubbing");
  }
}

function inworldAuthHeader() {
  const key = config.inworldApiKey;
  // Accept either raw key or already "Basic …"
  if (/^basic\s+/i.test(key)) return key;
  return `Basic ${key}`;
}

/**
 * Sleep for `ms`, waking early (and throwing "CANCELLED") when `shouldCancel` turns true.
 * @param {number} ms
 * @param {(() => boolean) | undefined} shouldCancel
 */
async function sleepCancelable(ms, shouldCancel) {
  const step = 500;
  let waited = 0;
  while (waited < ms) {
    if (shouldCancel?.()) throw new Error("CANCELLED");
    await new Promise((r) => setTimeout(r, Math.min(step, ms - waited)));
    waited += step;
  }
}

/**
 * Backoff for a retryable response. Honors `Retry-After` (seconds or HTTP-date); otherwise
 * uses a linear backoff for 429 (rate limit) and a shorter exponential backoff for 5xx.
 * @param {Response} res
 * @param {number} attempt zero-based attempt index
 */
function computeRetryDelayMs(res, attempt) {
  const header = res.headers?.get?.("retry-after");
  if (header) {
    const secs = Number(header);
    if (Number.isFinite(secs) && secs >= 0) {
      return Math.min(secs * 1000, RETRY_MAX_WAIT_MS);
    }
    const dateMs = Date.parse(header);
    if (!Number.isNaN(dateMs)) {
      return Math.min(Math.max(0, dateMs - Date.now()), RETRY_MAX_WAIT_MS);
    }
  }
  if (res.status === 429) {
    // Rate limit resets per minute: wait a bit longer each attempt.
    return Math.min(RATE_LIMIT_BASE_WAIT_MS + attempt * 15_000, RETRY_MAX_WAIT_MS);
  }
  // Transient 5xx: 2s, 4s, 8s … capped.
  return Math.min(2_000 * 2 ** attempt, 15_000);
}

/**
 * @param {string} method
 * @param {string} urlPath
 * @param {object} [opts]
 * @param {unknown} [opts.body]
 * @param {number} [opts.timeoutMs]
 * @param {number} [opts.maxRetries] Retry attempts for {@link INWORLD_RETRY_STATUSES} (default 0).
 * @param {() => boolean} [opts.shouldCancel] Abort retry waits early.
 */
async function inworldFetch(method, urlPath, opts = {}) {
  requireInworldKey();
  const base = config.inworldBaseUrl || "https://api.inworld.ai";
  const url = `${base}${urlPath.startsWith("/") ? urlPath : `/${urlPath}`}`;
  const timeoutMs = opts.timeoutMs ?? 120_000;
  const maxRetries = Math.max(0, opts.maxRetries ?? 0);
  const shouldCancel = opts.shouldCancel;

  for (let attempt = 0; ; attempt++) {
    if (shouldCancel?.()) throw new Error("CANCELLED");
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    let res;
    let text;
    try {
      /** @type {Record<string, string>} */
      const headers = {
        Authorization: inworldAuthHeader(),
      };
      let body;
      if (opts.body !== undefined) {
        headers["Content-Type"] = "application/json";
        body = JSON.stringify(opts.body);
      }
      res = await fetch(url, {
        method,
        headers,
        body,
        signal: controller.signal,
      });
      text = await res.text();
    } finally {
      clearTimeout(timer);
    }

    let json = null;
    try {
      json = text ? JSON.parse(text) : {};
    } catch {
      json = { raw: text };
    }
    if (res.ok) return json;

    const msg =
      (json && (json.message || json.error || json.statusMessage)) ||
      text.slice(0, 400) ||
      res.statusText;

    if (INWORLD_RETRY_STATUSES.has(res.status) && attempt < maxRetries) {
      const waitMs = computeRetryDelayMs(res, attempt);
      console.warn(
        `[dubbing] Inworld ${method} ${urlPath} → ${res.status}; retry ${attempt + 1}/${maxRetries} in ${Math.round(waitMs / 1000)}s`,
      );
      await sleepCancelable(waitMs, shouldCancel);
      continue;
    }

    throw new Error(`Inworld ${method} ${urlPath} → ${res.status}: ${msg}`);
  }
}

/**
 * Map ISO 639-1 to Inworld langCode (best-effort).
 * @param {string} code
 */
function toInworldLangCode(code) {
  const c = String(code || "en").trim().toLowerCase();
  const map = {
    en: "EN_US",
    es: "ES_ES",
    he: "HE_IL",
    fr: "FR_FR",
    de: "DE_DE",
    pt: "PT_BR",
    it: "IT_IT",
    ja: "JA_JP",
    zh: "ZH_CN",
    ko: "KO_KR",
    ar: "AR_SA",
    ru: "RU_RU",
    hi: "HI_IN",
    tr: "TR_TR",
    pl: "PL_PL",
    nl: "NL_NL",
    uk: "UK_UA",
    vi: "VI_VN",
    id: "ID_ID",
    el: "EL_GR",
    sv: "SV_SE",
    da: "DA_DK",
    fi: "FI_FI",
    cs: "CS_CZ",
    hu: "HU_HU",
    ro: "RO_RO",
  };
  return map[c] || "EN_US";
}

/**
 * @param {object} diarization
 * @returns {Array<{ speaker: string, start: number, end: number, text: string }>}
 */
export function normalizeDiarizationSegments(diarization) {
  const segs = Array.isArray(diarization?.segments) ? diarization.segments : [];
  return segs
    .map((s) => ({
      speaker: String(s?.speaker ?? "A").trim() || "A",
      start: Math.max(0, Number(s?.start) || 0),
      end: Math.max(0, Number(s?.end) || 0),
      text: String(s?.text ?? "").trim(),
    }))
    .filter((s) => s.end > s.start && s.text.length > 0);
}

/**
 * Pick contiguous windows totaling ~CLONE_TARGET_SEC of the longest speech for a speaker.
 * @param {Array<{ start: number, end: number }>} segments
 */
function pickCloneWindows(segments) {
  const sorted = [...segments].sort((a, b) => b.end - b.start - (a.end - a.start));
  /** @type {Array<{ start: number, end: number }>} */
  const picked = [];
  let total = 0;
  for (const s of sorted) {
    if (total >= CLONE_TARGET_SEC) break;
    const dur = s.end - s.start;
    if (dur < 0.4) continue;
    const take = Math.min(dur, CLONE_TARGET_SEC - total);
    picked.push({ start: s.start, end: s.start + take });
    total += take;
  }
  return { windows: picked, totalSec: total };
}

/**
 * @param {object} opts
 * @param {string} opts.inputMp4
 * @param {string} opts.outWav
 * @param {Array<{ start: number, end: number }>} opts.windows
 * @param {() => boolean} [opts.shouldCancel]
 */
async function extractSpeakerSampleWav(opts) {
  const { inputMp4, outWav, windows, shouldCancel } = opts;
  if (!windows.length) throw new Error("No audio windows for voice clone");
  // Concatenate selected windows via filter_complex.
  const inputs = [];
  const filters = [];
  for (let i = 0; i < windows.length; i++) {
    const w = windows[i];
    inputs.push("-ss", String(w.start), "-t", String(Math.max(0.2, w.end - w.start)), "-i", inputMp4);
    filters.push(`[${i}:a]aformat=sample_rates=48000:channel_layouts=mono[a${i}]`);
  }
  const concatIn = windows.map((_, i) => `[a${i}]`).join("");
  filters.push(`${concatIn}concat=n=${windows.length}:v=0:a=1[outa]`);
  await runFfmpeg(
    [
      "-y",
      ...inputs,
      "-filter_complex",
      filters.join(";"),
      "-map",
      "[outa]",
      "-c:a",
      "pcm_s16le",
      outWav,
    ],
    shouldCancel,
  );
}

/**
 * @param {object} opts
 * @param {string} opts.inputMp4
 * @param {object} opts.diarization
 * @param {string} opts.workDir
 * @param {string} [opts.sourceLanguage]
 * @param {() => boolean} [opts.shouldCancel]
 * @returns {Promise<{ voiceMap: Record<string, string | null>, voiceIds: string[] }>}
 */
export async function cloneSpeakerVoices(opts) {
  const { inputMp4, diarization, workDir, sourceLanguage = "en", shouldCancel } = opts;
  const segments = normalizeDiarizationSegments(diarization);
  /** @type {Record<string, Array<{ start: number, end: number, text: string }>>} */
  const bySpeaker = {};
  for (const s of segments) {
    if (!bySpeaker[s.speaker]) bySpeaker[s.speaker] = [];
    bySpeaker[s.speaker].push(s);
  }

  /** @type {Record<string, string | null>} */
  const voiceMap = {};
  /** @type {string[]} */
  const voiceIds = [];
  const langCode = toInworldLangCode(sourceLanguage === "auto" ? "en" : sourceLanguage);

  for (const [speaker, segs] of Object.entries(bySpeaker)) {
    if (shouldCancel?.()) throw new Error("CANCELLED");
    const { windows, totalSec } = pickCloneWindows(segs);
    if (totalSec < CLONE_MIN_SEC) {
      voiceMap[speaker] = null;
      continue;
    }
    const wavPath = path.join(workDir, `clone_${speaker.replace(/[^\w.-]/g, "_")}.wav`);
    try {
      await extractSpeakerSampleWav({ inputMp4, outWav: wavPath, windows, shouldCancel });
      const buf = await fs.readFile(wavPath);
      const audioB64 = buf.toString("base64");
      const json = await inworldFetch("POST", "/voices/v1/voices:clone", {
        body: {
          displayName: `l2v_${speaker}_${Date.now()}`,
          langCode,
          voiceSamples: [{ audioData: audioB64 }],
          removeBackgroundNoise: true,
        },
        timeoutMs: 90_000,
        // Inworld throttles clone to ~2 req/min; retry on 429 (and transient 5xx) with backoff.
        maxRetries: CLONE_MAX_RETRIES,
        shouldCancel,
      });
      const voiceId =
        json?.voice?.voiceId || json?.voiceId || json?.result?.voice?.voiceId || null;
      if (voiceId) {
        voiceMap[speaker] = String(voiceId);
        voiceIds.push(String(voiceId));
      } else {
        voiceMap[speaker] = null;
      }
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      // Let cancellation abort the whole job instead of silently dropping the speaker's voice.
      if (message === "CANCELLED") throw e;
      console.warn(`[dubbing] clone failed speaker=${speaker}:`, message);
      voiceMap[speaker] = null;
    } finally {
      await fs.unlink(wavPath).catch(() => {});
    }
  }

  return { voiceMap, voiceIds };
}

/**
 * Best-effort delete of ephemeral cloned voices.
 * @param {string[]} voiceIds
 */
export async function deleteClonedVoices(voiceIds) {
  const ids = Array.isArray(voiceIds) ? voiceIds.filter(Boolean) : [];
  for (const id of ids) {
    try {
      await inworldFetch("DELETE", `/voices/v1/voices/${encodeURIComponent(id)}`, {
        timeoutMs: 30_000,
      });
    } catch (e) {
      console.warn(
        `[dubbing] delete voice ${id} failed:`,
        e instanceof Error ? e.message : String(e),
      );
    }
  }
}

/**
 * @param {Array<{ speaker: string, start: number, end: number, text: string }>} segments
 * @param {string} sourceLang
 * @param {string} targetLang
 * @param {() => boolean} [shouldCancel]
 */
export async function translateSegments(segments, sourceLang, targetLang, shouldCancel) {
  if (!segments.length) return [];
  if (shouldCancel?.()) throw new Error("CANCELLED");
  const src = String(sourceLang || "auto");
  const tgt = String(targetLang || "en");
  if (src !== "auto" && src === tgt) {
    return segments.map((s) => ({ ...s, text: s.text }));
  }

  const payload = segments.map((s, i) => ({ i, text: s.text }));
  const system = `You are a professional dubbing translator. Translate each item's "text" into language code "${tgt}"${
    src !== "auto" ? ` from "${src}"` : ""
  }. Preserve meaning and keep lines concise for speech. Return ONLY a JSON array of { "i": number, "text": string } with the same indices.`;

  const chatPath = config.inworldLlmChatPath || "/v1/chat/completions";
  const json = await inworldFetch("POST", chatPath, {
    body: {
      model: config.inworldLlmModel || "gpt-4o-mini",
      temperature: 0.2,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: system },
        {
          role: "user",
          content: JSON.stringify({ items: payload }),
        },
      ],
    },
    timeoutMs: 120_000,
  });

  const content = json?.choices?.[0]?.message?.content;
  let parsed;
  try {
    parsed = typeof content === "string" ? JSON.parse(content) : content;
  } catch {
    throw new Error("Inworld LLM returned non-JSON translation");
  }
  const items = Array.isArray(parsed)
    ? parsed
    : Array.isArray(parsed?.items)
      ? parsed.items
      : Array.isArray(parsed?.translations)
        ? parsed.translations
        : null;
  if (!items) throw new Error("Inworld LLM translation missing items array");

  /** @type {Map<number, string>} */
  const byIndex = new Map();
  for (const it of items) {
    const i = Number(it?.i);
    const text = String(it?.text ?? "").trim();
    if (Number.isFinite(i) && text) byIndex.set(i, text);
  }

  return segments.map((s, i) => ({
    ...s,
    text: byIndex.get(i) || s.text,
  }));
}

/**
 * Synthesize a single cue at the voice's natural speaking rate.
 *
 * NOTE: We intentionally do NOT time-fit the dubbed audio to the source cue window.
 * Fitting used to change the speaking rate (and residual `atempo`) to match the original
 * duration, which made short lines drag (slowed down / "enormously long") and long lines
 * sound rushed. Segments are placed at their original start time and the track mix trims to
 * the clip duration, so natural pacing is preferred over exact fit.
 *
 * @param {object} opts
 * @param {string | null} opts.voiceId
 * @param {string} opts.text
 * @param {string} opts.lang
 * @param {string} opts.outWav
 * @param {() => boolean} [opts.shouldCancel]
 */
async function synthesizeSegment(opts) {
  const { voiceId, text, lang, outWav, shouldCancel } = opts;
  if (!voiceId) throw new Error("Missing voiceId for TTS");
  if (shouldCancel?.()) throw new Error("CANCELLED");

  const json = await inworldFetch("POST", "/tts/v1/voice", {
    body: {
      text,
      voiceId,
      modelId: config.inworldTtsModel || "inworld-tts-2",
      timestampType: "WORD",
      // No speakingRate override: use the natural rate (no speed modification).
      audioConfig: {
        audioEncoding: "LINEAR16",
        sampleRateHertz: 48000,
      },
      language: toInworldLangCode(lang),
    },
    timeoutMs: 90_000,
    // TTS is called once per cue; retry rate-limit / transient errors with backoff.
    maxRetries: CLONE_MAX_RETRIES,
    shouldCancel,
  });
  const b64 = json?.audioContent || json?.audio || json?.result?.audioContent;
  if (!b64) throw new Error("Inworld TTS returned no audioContent");
  const raw = Buffer.from(b64, "base64");
  // Write as raw s16le then wrap, or assume WAV — Inworld LINEAR16 is often raw PCM.
  // Prefer decoding via ffmpeg from a temp .pcm if no RIFF header.
  const tmpRaw = `${outWav}.raw`;
  await fs.writeFile(tmpRaw, raw);
  const isWav = raw.length >= 12 && raw.toString("ascii", 0, 4) === "RIFF";
  if (isWav) {
    await fs.rename(tmpRaw, outWav);
  } else {
    await runFfmpeg(
      ["-y", "-f", "s16le", "-ar", "48000", "-ac", "1", "-i", tmpRaw, "-c:a", "pcm_s16le", outWav],
      shouldCancel,
    );
    await fs.unlink(tmpRaw).catch(() => {});
  }

  const durationSec = await ffprobeDurationSec(outWav);
  return { durationSec, speakingRate: 1.0 };
}

/**
 * Place each segment WAV at its original start time and pad to clip duration.
 * @param {object} opts
 * @param {Array<{ start: number, end: number, wavPath: string }>} opts.pieces
 * @param {number} opts.clipDurationSec
 * @param {string} opts.outWav
 * @param {() => boolean} [opts.shouldCancel]
 */
async function assembleTrackForLanguage(opts) {
  const { pieces, clipDurationSec, outWav, shouldCancel } = opts;
  const duration = Math.max(0.1, clipDurationSec);
  if (!pieces.length) {
    // Silence track of full duration.
    await runFfmpeg(
      [
        "-y",
        "-f",
        "lavfi",
        "-i",
        `anullsrc=r=48000:cl=mono`,
        "-t",
        String(duration),
        "-c:a",
        "pcm_s16le",
        outWav,
      ],
      shouldCancel,
    );
    return;
  }

  const inputs = [];
  const filters = [];
  for (let i = 0; i < pieces.length; i++) {
    const p = pieces[i];
    const delayMs = Math.max(0, Math.round(p.start * 1000));
    inputs.push("-i", p.wavPath);
    filters.push(
      `[${i}:a]aformat=sample_rates=48000:channel_layouts=mono,adelay=${delayMs}|${delayMs},apad=whole_dur=${duration.toFixed(3)}[a${i}]`,
    );
  }
  const mixIn = pieces.map((_, i) => `[a${i}]`).join("");
  filters.push(
    `${mixIn}amix=inputs=${pieces.length}:duration=longest:dropout_transition=0:normalize=0,atrim=0:${duration.toFixed(3)},asetpts=PTS-STARTPTS[outa]`,
  );

  await runFfmpeg(
    ["-y", ...inputs, "-filter_complex", filters.join(";"), "-map", "[outa]", "-c:a", "pcm_s16le", outWav],
    shouldCancel,
  );
}

/**
 * Mux original video+audio with additional dubbed AAC tracks.
 * @param {object} opts
 * @param {string} opts.inputMp4
 * @param {Array<{ lang: string, wavPath: string, title?: string }>} opts.tracks
 * @param {string} opts.outputMp4
 * @param {() => boolean} [opts.shouldCancel]
 */
export async function muxDubbedTracksIntoMp4(opts) {
  const { inputMp4, tracks, outputMp4, shouldCancel } = opts;
  if (!tracks.length) {
    await fs.copyFile(inputMp4, outputMp4);
    return;
  }

  const args = ["-y", "-i", inputMp4];
  for (const t of tracks) {
    args.push("-i", t.wavPath);
  }

  // Map video + original audio + each dubbed track.
  args.push("-map", "0:v:0", "-map", "0:a:0?");
  for (let i = 0; i < tracks.length; i++) {
    args.push("-map", `${i + 1}:a:0`);
  }

  args.push("-c:v", "copy");
  // Re-encode all audio to AAC for consistent container.
  args.push("-c:a", "aac", "-b:a", "128k");

  // Metadata: track 0 = original, then dubbed.
  args.push("-metadata:s:a:0", "language=und", "-metadata:s:a:0", "title=Original");
  for (let i = 0; i < tracks.length; i++) {
    const lang = String(tracks[i].lang || "und").toLowerCase().slice(0, 3);
    const title = tracks[i].title || `Dub ${lang}`;
    const idx = i + 1;
    args.push(`-metadata:s:a:${idx}`, `language=${lang}`);
    args.push(`-metadata:s:a:${idx}`, `title=${title}`);
  }

  args.push("-movflags", "+faststart", outputMp4);
  await runFfmpeg(args, shouldCancel);
}

/**
 * Resolve target languages from clip dubbing config / root spec.
 * @param {object} [clip]
 * @param {object} [spec]
 * @returns {string[]}
 */
export function resolveDubbingTargetLanguages(clip, spec) {
  const locales = clip?.dubbing?.targetLocales;
  if (locales && typeof locales === "object") {
    return Object.entries(locales)
      .filter(([, on]) => on === true)
      .map(([code]) => String(code).toLowerCase())
      .filter(Boolean);
  }
  if (Array.isArray(spec?.dubbingLanguages)) {
    return spec.dubbingLanguages.map((c) => String(c).toLowerCase()).filter(Boolean);
  }
  return [];
}

/**
 * Full dubbing pipeline for one encoded MP4.
 *
 * @param {object} opts
 * @param {string} opts.inputMp4
 * @param {string} opts.workDir
 * @param {object} opts.diarization
 * @param {object} [opts.clip]
 * @param {object} [opts.spec]
 * @param {(pct: number, message?: string) => void} [opts.onProgress]
 * @param {() => boolean} [opts.shouldCancel]
 * @returns {Promise<{ outputMp4: string, voiceIds: string[], targetLanguages: string[] }>}
 */
export async function applyInworldDubbingToMp4(opts) {
  const { inputMp4, workDir, diarization, clip, spec, onProgress, shouldCancel } = opts;
  requireInworldKey();

  const targetLanguages = resolveDubbingTargetLanguages(clip, spec);
  if (!targetLanguages.length) {
    return { outputMp4: inputMp4, voiceIds: [], targetLanguages: [] };
  }

  const sourceLanguage = String(
    clip?.dubbing?.sourceLanguage || clip?.subtitles?.whisperSourceLanguage || "auto",
  ).toLowerCase();

  const segments = normalizeDiarizationSegments(diarization);
  if (!segments.length) {
    throw new Error("AI dubbing requires diarized STT segments");
  }

  onProgress?.(5, "Cloning speaker voices (Inworld)");
  const { voiceMap, voiceIds } = await cloneSpeakerVoices({
    inputMp4,
    diarization,
    workDir,
    sourceLanguage,
    shouldCancel,
  });

  // Fallback: if any speaker lacks a clone, reuse another cloned voice.
  const anyVoice = Object.values(voiceMap).find(Boolean) || null;
  for (const sp of Object.keys(voiceMap)) {
    if (!voiceMap[sp] && anyVoice) voiceMap[sp] = anyVoice;
  }
  if (!anyVoice) {
    await deleteClonedVoices(voiceIds);
    throw new Error("Could not clone any speaker voice for dubbing (need ≥3s clean speech per speaker)");
  }

  const clipDurationSec = await ffprobeDurationSec(inputMp4);
  /** @type {Array<{ lang: string, wavPath: string, title?: string }>} */
  const dubbedTracks = [];

  try {
    for (let li = 0; li < targetLanguages.length; li++) {
      const lang = targetLanguages[li];
      if (shouldCancel?.()) throw new Error("CANCELLED");
      const basePct = 10 + (li / targetLanguages.length) * 75;
      onProgress?.(Math.round(basePct), `Translating to ${lang}`);

      const translated = await translateSegments(segments, sourceLanguage, lang, shouldCancel);
      /** @type {Array<{ start: number, end: number, wavPath: string }>} */
      const pieces = [];

      for (let si = 0; si < translated.length; si++) {
        if (shouldCancel?.()) throw new Error("CANCELLED");
        const seg = translated[si];
        const voiceId = voiceMap[seg.speaker] || anyVoice;
        const segWav = path.join(workDir, `tts_${lang}_${si}.wav`);
        const pct =
          basePct + ((si + 1) / Math.max(1, translated.length)) * (70 / targetLanguages.length);
        onProgress?.(Math.round(pct), `TTS ${lang} segment ${si + 1}/${translated.length}`);
        try {
          await synthesizeSegment({
            voiceId,
            text: seg.text,
            lang,
            outWav: segWav,
            shouldCancel,
          });
          pieces.push({ start: seg.start, end: seg.end, wavPath: segWav });
        } catch (e) {
          console.warn(
            `[dubbing] TTS failed lang=${lang} seg=${si}:`,
            e instanceof Error ? e.message : String(e),
          );
        }
      }

      const trackWav = path.join(workDir, `dub_track_${lang}.wav`);
      onProgress?.(Math.round(basePct + 70 / targetLanguages.length), `Assembling ${lang} track`);
      await assembleTrackForLanguage({
        pieces,
        clipDurationSec,
        outWav: trackWav,
        shouldCancel,
      });
      dubbedTracks.push({ lang, wavPath: trackWav, title: `Dub ${lang.toUpperCase()}` });
    }

    const outMp4 = path.join(workDir, "dubbed_multi_audio.mp4");
    onProgress?.(92, "Muxing dubbed audio tracks");
    await muxDubbedTracksIntoMp4({
      inputMp4,
      tracks: dubbedTracks,
      outputMp4: outMp4,
      shouldCancel,
    });

    onProgress?.(98, "Dubbing complete");
    return { outputMp4: outMp4, voiceIds, targetLanguages };
  } catch (e) {
    await deleteClonedVoices(voiceIds);
    throw e;
  }
}
