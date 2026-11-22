import { vodEncodeStdout } from "./vod-encode-log.js";

/**
 * Normalize OpenAI usage from Chat Completions or Audio transcription responses,
 * estimate USD (approximate list prices), and build clip-level reports for logging + job PATCH.
 *
 * Pricing: defaults match OpenAI consumer list tiers as of early 2026; override via code when rates change.
 * See https://platform.openai.com/docs/pricing
 */

/** USD per 1M text tokens (input / output). */
const CHAT_USD_PER_1M = {
  "gpt-4o-mini": { in: 0.15, out: 0.6 },
  "gpt-4o": { in: 2.5, out: 10 },
  "gpt-4.1-mini": { in: 0.4, out: 1.6 },
};

/** USD per 1M audio STT tokens (input / output) where API returns token usage. */
const STT_USD_PER_1M = {
  "gpt-4o-transcribe": { in: 2.5, out: 10 },
  "gpt-4o-transcribe-diarize": { in: 2.5, out: 10 },
  "gpt-4o-mini-transcribe": { in: 1.25, out: 5 },
};

/** Whisper-1: billed by audio minute (API may return duration usage instead of tokens). */
const WHISPER_USD_PER_MINUTE = 0.006;

/**
 * @param {string} model
 */
function modelKey(model) {
  return String(model || "")
    .trim()
    .toLowerCase()
    .replace(/[._]20\d{2}-\d{2}-\d{2}$/, "")
    .replace(/@\d+$/, "");
}

/**
 * @param {string} model
 * @param {{ kind: 'tokens', inputTokens: number, outputTokens: number, totalTokens: number } | { kind: 'duration', audioSeconds: number } | null} norm
 * @returns {number}
 */
export function estimateOpenAiUsd(model, norm) {
  if (!norm) return 0;
  const m = modelKey(model);
  if (norm.kind === "duration") {
    const sec = Math.max(0, Number(norm.audioSeconds) || 0);
    if (m.includes("whisper")) {
      return roundUsd((sec / 60) * WHISPER_USD_PER_MINUTE);
    }
    return 0;
  }
  const input = Math.max(0, Number(norm.inputTokens) || 0);
  const output = Math.max(0, Number(norm.outputTokens) || 0);
  const st = STT_USD_PER_1M[m];
  if (st) {
    return roundUsd((input / 1e6) * st.in + (output / 1e6) * st.out);
  }
  const ch = CHAT_USD_PER_1M[m];
  if (ch) {
    return roundUsd((input / 1e6) * ch.in + (output / 1e6) * ch.out);
  }
  /** Fallback: treat unknown model as gpt-4o-mini chat if it looks like a mini model. */
  if (m.includes("mini") && !m.includes("transcribe")) {
    const f = CHAT_USD_PER_1M["gpt-4o-mini"];
    return roundUsd((input / 1e6) * f.in + (output / 1e6) * f.out);
  }
  if (m.includes("transcribe")) {
    const f = STT_USD_PER_1M["gpt-4o-transcribe"];
    return roundUsd((input / 1e6) * f.in + (output / 1e6) * f.out);
  }
  return 0;
}

/**
 * @param {number} n
 */
function roundUsd(n) {
  return Math.round(n * 1e6) / 1e6;
}

/**
 * @param {unknown} usage
 * @returns {{ kind: 'tokens', inputTokens: number, outputTokens: number, totalTokens: number } | { kind: 'duration', audioSeconds: number } | null}
 */
export function normalizeOpenAiUsageObject(usage) {
  if (!usage || typeof usage !== "object") return null;
  /** @type {any} */
  const u = usage;
  if (u.type === "duration" && typeof u.seconds === "number") {
    return { kind: "duration", audioSeconds: u.seconds };
  }
  const input = Number(u.prompt_tokens ?? u.input_tokens ?? 0) || 0;
  const output = Number(u.completion_tokens ?? u.output_tokens ?? 0) || 0;
  const totalRaw = u.total_tokens;
  const total =
    typeof totalRaw === "number" && Number.isFinite(totalRaw)
      ? totalRaw
      : input + output;
  if (input === 0 && output === 0 && total === 0) return null;
  return { kind: "tokens", inputTokens: input, outputTokens: output, totalTokens: total };
}

/**
 * @param {object} data top-level OpenAI JSON (chat completion or transcription).
 */
export function normalizeUsageFromResponseJson(data) {
  if (!data || typeof data !== "object") return null;
  return normalizeOpenAiUsageObject(/** @type {any} */ (data).usage);
}

/**
 * @param {Array<Record<string, unknown>>} steps
 */
export function buildOpenAiClipUsageReport(steps) {
  const list = Array.isArray(steps) ? steps : [];
  let totalTokens = 0;
  let estimatedTotalUsd = 0;
  for (const s of list) {
    totalTokens += typeof s.totalTokens === "number" ? s.totalTokens : 0;
    estimatedTotalUsd += typeof s.estimatedUsd === "number" ? s.estimatedUsd : 0;
  }
  return {
    version: 1,
    currency: "USD",
    steps: list,
    totalTokens,
    estimatedTotalUsd: roundUsd(estimatedTotalUsd),
    pricingNote:
      "estimatedTotalUsd uses approximate OpenAI list prices; verify on https://platform.openai.com/docs/pricing",
  };
}

/**
 * @param {Record<string, unknown> | null | undefined} a
 * @param {Record<string, unknown> | null | undefined} b
 */
export function mergeOpenAiClipUsageReports(a, b) {
  const sa = a && typeof a === "object" && Array.isArray(a.steps) ? a.steps : [];
  const sb = b && typeof b === "object" && Array.isArray(b.steps) ? b.steps : [];
  return buildOpenAiClipUsageReport([...sa, ...sb]);
}

/**
 * @param {string} jobId
 * @param {string} phaseLabel
 * @param {Record<string, unknown> | null | undefined} report
 */
export function logOpenAiClipUsage(jobId, phaseLabel, report) {
  if (!report || typeof report !== "object") return;
  const total = typeof report.totalTokens === "number" ? report.totalTokens : 0;
  const usd = typeof report.estimatedTotalUsd === "number" ? report.estimatedTotalUsd : 0;
  const steps = Array.isArray(report.steps) ? report.steps.length : 0;
  const line = `openai-usage job=${jobId} phase=${phaseLabel} steps=${steps} totalTokens=${total} estimatedUsd=${usd.toFixed(6)}`;
  // eslint-disable-next-line no-console
  console.log(`[encoder-lite] ${line}`);
  vodEncodeStdout(line);
}

/**
 * Aggregate token and USD figures from a clip usage report (sums step rows; uses report totals when set).
 *
 * @param {Record<string, unknown> | null | undefined} report
 * @returns {{
 *   inputTokens: number;
 *   outputTokens: number;
 *   totalTokens: number;
 *   estimatedUsd: number;
 *   stepCount: number;
 *   audioSecondsFromSteps: number;
 *   stepKinds: string;
 * }}
 */
export function summarizeOpenAiClipUsageReport(report) {
  const empty = {
    inputTokens: 0,
    outputTokens: 0,
    totalTokens: 0,
    estimatedUsd: 0,
    stepCount: 0,
    audioSecondsFromSteps: 0,
    stepKinds: "",
  };
  if (!report || typeof report !== "object") return empty;
  const steps = Array.isArray(report.steps) ? report.steps : [];
  let inputTokens = 0;
  let outputTokens = 0;
  let audioSecondsFromSteps = 0;
  let sumStepEstimatedUsd = 0;
  const kinds = [];
  for (const s of steps) {
    inputTokens += Number(s.inputTokens) || 0;
    outputTokens += Number(s.outputTokens) || 0;
    audioSecondsFromSteps += Number(s.audioSeconds) || 0;
    sumStepEstimatedUsd += Number(s.estimatedUsd) || 0;
    if (typeof s.step === "string" && s.step) kinds.push(s.step);
  }
  const totalFromReport = typeof report.totalTokens === "number" ? report.totalTokens : 0;
  const totalTokens =
    totalFromReport > 0 ? totalFromReport : inputTokens + outputTokens;
  const estimatedUsd =
    typeof report.estimatedTotalUsd === "number" && Number.isFinite(report.estimatedTotalUsd)
      ? report.estimatedTotalUsd
      : roundUsd(sumStepEstimatedUsd);
  return {
    inputTokens,
    outputTokens,
    totalTokens,
    estimatedUsd,
    stepCount: steps.length,
    audioSecondsFromSteps,
    stepKinds: [...new Set(kinds)].join(","),
  };
}

/**
 * One-line console + stdout: full realtime-transcribe clip OpenAI cost (STT + optional news).
 *
 * @param {object} p
 * @param {string} p.jobId
 * @param {string} [p.tenantId]
 * @param {string} [p.editorClipId]
 * @param {number} [p.clipAudioSeconds] segment length processed (spec clip window)
 * @param {Record<string, unknown> | null | undefined} p.report merged openaiClipUsage
 * @param {boolean} [p.newsIncluded] trilingual news step included in cost
 */
export function logRealtimeTranscribeClipOpenAiCost(p) {
  const agg = summarizeOpenAiClipUsageReport(p.report);
  const tenant = String(p.tenantId || "").trim() || "-";
  const clipId = String(p.editorClipId || "").trim() || "-";
  const audio =
    typeof p.clipAudioSeconds === "number" && Number.isFinite(p.clipAudioSeconds) ? p.clipAudioSeconds : 0;
  const news = p.newsIncluded ? "yes" : "no";
  const line =
    `realtime-transcribe-clip-openai-cost job=${p.jobId} tenant=${tenant} editorClipId=${clipId} ` +
    `clipAudioSec=${audio.toFixed(3)} news=${news} ` +
    `tokens_in=${agg.inputTokens} tokens_out=${agg.outputTokens} tokens_total=${agg.totalTokens} ` +
    `estimated_usd_total=${agg.estimatedUsd.toFixed(6)} steps=${agg.stepCount} step_kinds=[${agg.stepKinds}]`;
  // eslint-disable-next-line no-console
  console.log(`[encoder-lite] ${line}`);
  vodEncodeStdout(line);
}

/**
 * @param {object} p
 * @param {string} p.step
 * @param {string} p.model
 * @param {number} [p.chunkIndex]
 * @param {ReturnType<typeof normalizeOpenAiUsageObject>} p.usage
 */
export function usageStepRow(p) {
  const { step, model, chunkIndex, usage } = p;
  const norm = usage;
  let inputTokens = 0;
  let outputTokens = 0;
  let totalTokens = 0;
  let audioSeconds = 0;
  if (norm && norm.kind === "tokens") {
    inputTokens = norm.inputTokens;
    outputTokens = norm.outputTokens;
    totalTokens = norm.totalTokens;
  } else if (norm && norm.kind === "duration") {
    audioSeconds = norm.audioSeconds;
  }
  const estimatedUsd = estimateOpenAiUsd(model, norm);
  /** @type {Record<string, unknown>} */
  const row = {
    step,
    model: String(model || "").trim(),
    inputTokens,
    outputTokens,
    totalTokens,
    estimatedUsd,
  };
  if (typeof chunkIndex === "number") row.chunkIndex = chunkIndex;
  if (audioSeconds > 0) row.audioSeconds = audioSeconds;
  return row;
}
