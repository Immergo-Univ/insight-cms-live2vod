"""Zero-shot audio classification using CLAP (Contrastive Language-Audio Pretraining).

CLAP is the audio analogue of CLIP: the model learns a shared embedding space between text
prompts and short audio clips (music + speech + general environmental sounds). We use it to
answer "what kind of content is this?" purely from the audio channel, scoring the clip against
a fixed list of category prompts (Television commercial / News broadcast / ...).

The Node orchestrator hands us the extracted mono 48 kHz WAV of the analysis window plus a
`chunk_seconds` value; we slice the waveform into non-overlapping chunks (5 s by default), score
each chunk against the category prompts in a single batched forward pass and return per-chunk
categories with their timing so the caller can pinpoint when an AD begins inside the window.
"""

import os
import threading
import wave

import numpy as np
import torch
from transformers import ClapModel, ClapProcessor

# CLAP expects 48 kHz mono audio. We keep this constant so ffmpeg/media.service can produce the
# WAV at exactly this rate and we avoid pulling librosa/scipy just for resampling.
TARGET_SR = 48000


def _load_mono_wav(path: str) -> tuple[np.ndarray, int]:
    """Read a PCM WAV file into a float32 numpy array in [-1, 1] plus its sample rate.

    Uses the stdlib `wave` module to avoid pulling libsndfile as a system dependency."""
    with wave.open(path, "rb") as wf:
        n_channels = wf.getnchannels()
        sample_width = wf.getsampwidth()
        sample_rate = wf.getframerate()
        n_frames = wf.getnframes()
        raw = wf.readframes(n_frames)

    if sample_width == 2:
        audio = np.frombuffer(raw, dtype=np.int16).astype(np.float32) / 32768.0
    elif sample_width == 4:
        audio = np.frombuffer(raw, dtype=np.int32).astype(np.float32) / 2147483648.0
    elif sample_width == 1:
        # 8-bit PCM is unsigned in WAV.
        audio = (np.frombuffer(raw, dtype=np.uint8).astype(np.float32) - 128.0) / 128.0
    else:
        raise ValueError(f"unsupported WAV sample width: {sample_width}")

    if n_channels > 1:
        audio = audio.reshape(-1, n_channels).mean(axis=1)

    return audio.astype(np.float32), sample_rate


def _resample_linear(audio: np.ndarray, src_sr: int, dst_sr: int) -> np.ndarray:
    """Simple linear resampler used as a safety net when ffmpeg didn't output at TARGET_SR.

    Not audiophile-grade but plenty for CLAP's log-mel feature extraction, and it avoids adding
    scipy/resampy as dependencies just for the rare mismatched-sample-rate case."""
    if src_sr == dst_sr or audio.size == 0:
        return audio
    src_len = audio.shape[0]
    dst_len = int(round(src_len * dst_sr / src_sr))
    if dst_len <= 0:
        return np.zeros(0, dtype=np.float32)
    src_idx = np.linspace(0, src_len - 1, dst_len, dtype=np.float64)
    left = np.floor(src_idx).astype(np.int64)
    right = np.clip(left + 1, 0, src_len - 1)
    frac = (src_idx - left).astype(np.float32)
    return ((1.0 - frac) * audio[left] + frac * audio[right]).astype(np.float32)


class AudioClapClassifier:
    """Zero-shot audio → category classifier backed by a CLAP model.

    Loaded once at sidecar startup; inference is guarded by a lock so concurrent requests don't
    race on the underlying nn.Module state."""

    def __init__(self, model_id: str, categories: list[str]):
        self.model_id = model_id
        self.categories = list(categories)
        # CLAP zero-shot works best with a descriptive prompt template; the class name alone often
        # under-performs because it drifts far from the natural-language captions CLAP was trained on.
        self.prompts = [f"the sound of a {c.lower()}" for c in self.categories]
        self._lock = threading.Lock()

        self.device = "cpu"
        torch.set_num_threads(max(1, os.cpu_count() or 1))
        self.processor = ClapProcessor.from_pretrained(model_id)
        self.model = ClapModel.from_pretrained(model_id).to(self.device).eval()

        # Pre-tokenize the fixed text prompts once so per-request work is just audio encoding
        # + a text encoder forward pass on cached tokens + the contrastive dot product. Keeping
        # the text encoder in the graph (instead of caching final embeddings and reconstructing
        # `logits_per_audio` manually) means we trust the model's trained logit_scale rather than
        # guessing whether the checkpoint stored the raw or exp'd scale.
        self._text_inputs = self.processor(
            text=self.prompts, return_tensors="pt", padding=True
        ).to(self.device)

    def _chunkify(self, audio: np.ndarray, chunk_seconds: float) -> list[tuple[float, float, np.ndarray]]:
        """Slice the (mono, TARGET_SR) waveform into non-overlapping chunks.

        Returns a list of (start_sec, end_sec, chunk_audio). Chunks shorter than 0.5 s at the tail
        are dropped so CLAP's feature extractor doesn't complain about too-short clips."""
        chunk_samples = max(1, int(round(chunk_seconds * TARGET_SR)))
        chunks = []
        total = audio.shape[0]
        i = 0
        idx = 0
        while i < total:
            end = min(i + chunk_samples, total)
            length = end - i
            if length < int(TARGET_SR * 0.5) and idx > 0:
                # Tail smaller than half a second: fold into previous chunk instead of scoring it
                # on its own (too little context for CLAP).
                prev_start, prev_end, prev_audio = chunks[-1]
                merged = np.concatenate([prev_audio, audio[i:end]])
                chunks[-1] = (prev_start, end / TARGET_SR, merged)
            else:
                chunks.append((i / TARGET_SR, end / TARGET_SR, audio[i:end]))
            i = end
            idx += 1
        return chunks

    @torch.inference_mode()
    def _score_chunks(self, chunk_arrays: list[np.ndarray]) -> np.ndarray:
        """Return a [n_chunks, n_categories] matrix of probabilities (softmax over categories)."""
        audio_inputs = self.processor(
            audios=chunk_arrays,
            return_tensors="pt",
            padding=True,
            sampling_rate=TARGET_SR,
        ).to(self.device)
        # Full model forward: applies the trained logit_scale and L2-normalizes internally so we
        # don't have to worry about whether the checkpoint stored the raw or exp'd scale.
        outputs = self.model(
            input_ids=self._text_inputs["input_ids"],
            attention_mask=self._text_inputs.get("attention_mask"),
            input_features=audio_inputs["input_features"],
            is_longer=audio_inputs.get("is_longer"),
            return_dict=True,
        )
        # logits_per_audio: [n_chunks, n_prompts]. Softmax across prompts → per-audio distribution.
        probs = torch.softmax(outputs.logits_per_audio, dim=-1)
        return probs.cpu().numpy()

    def classify(self, audio_path: str, chunk_seconds: float = 5.0) -> dict:
        """Classify a single WAV file.

        Returns a dict shaped like:
            {
              "chunks": [
                { "startSec": 0.0, "endSec": 5.0, "category": "...", "score": 0.71,
                  "scores": { "<cat>": 0.71, ... } },
                ...
              ],
              "avg": {
                "category": "...",
                "score": 0.55,
                "per_category": { "<cat>": ..., ... }
              },
              "last": { "category": "...", "score": ..., "startSec": 15.0, "endSec": 20.0 },
              "durationSec": 20.0,
              "chunkSeconds": 5.0
            }
        """
        audio, sr = _load_mono_wav(audio_path)
        if audio.size == 0:
            return {
                "chunks": [],
                "avg": {"category": "unknown", "score": 0.0, "per_category": {}},
                "last": None,
                "durationSec": 0.0,
                "chunkSeconds": chunk_seconds,
            }

        if sr != TARGET_SR:
            audio = _resample_linear(audio, sr, TARGET_SR)

        chunks = self._chunkify(audio, chunk_seconds)
        if not chunks:
            return {
                "chunks": [],
                "avg": {"category": "unknown", "score": 0.0, "per_category": {}},
                "last": None,
                "durationSec": float(audio.shape[0] / TARGET_SR),
                "chunkSeconds": chunk_seconds,
            }

        chunk_arrays = [c[2] for c in chunks]

        with self._lock:
            probs = self._score_chunks(chunk_arrays)  # [n_chunks, n_cat]

        n_cat = len(self.categories)
        out_chunks = []
        acc = np.zeros(n_cat, dtype=np.float64)
        for (start, end, _arr), row in zip(chunks, probs):
            best_idx = int(np.argmax(row))
            out_chunks.append(
                {
                    "startSec": round(float(start), 2),
                    "endSec": round(float(end), 2),
                    "category": self.categories[best_idx],
                    "score": round(float(row[best_idx]), 4),
                    "scores": {
                        self.categories[i]: round(float(row[i]), 4) for i in range(n_cat)
                    },
                }
            )
            acc += row

        avg = acc / max(1, len(out_chunks))
        avg_idx = int(np.argmax(avg))
        last = out_chunks[-1]

        return {
            "chunks": out_chunks,
            "avg": {
                "category": self.categories[avg_idx],
                "score": round(float(avg[avg_idx]), 4),
                "per_category": {
                    self.categories[i]: round(float(avg[i]), 4) for i in range(n_cat)
                },
            },
            "last": {
                "startSec": last["startSec"],
                "endSec": last["endSec"],
                "category": last["category"],
                "score": last["score"],
            },
            "durationSec": round(float(audio.shape[0] / TARGET_SR), 2),
            "chunkSeconds": float(chunk_seconds),
        }
