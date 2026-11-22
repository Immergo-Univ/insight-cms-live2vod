/**
 * ffmpeg input flags for remote (HTTP/HLS) sources. Mirrors encoder-lite `ffmpegInputGlobalArgs`.
 * @param {string} inputUrl
 * @returns {string[]}
 */
export function ffmpegInputGlobalArgs(inputUrl) {
  const out = [];
  if (!/^https?:\/\//i.test(String(inputUrl || ""))) return out;
  out.push("-protocol_whitelist", "file,http,https,tcp,tls,crypto,subfile");
  const ua = (
    process.env.VOD_FFMPEG_USER_AGENT ||
    process.env.VOD_FFPROBE_USER_AGENT ||
    process.env.LOGO_DETECTOR_FFMPEG_UA ||
    ""
  ).trim();
  if (ua) out.push("-user_agent", ua);
  return out;
}
