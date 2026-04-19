/**
 * VOD clip encode progress — always writes a full line to stdout (line-buffered for docker logs).
 * @param {...unknown} parts
 */
export function vodEncodeStdout(...parts) {
  const line = parts.map((p) => (p == null ? "" : String(p))).join(" ");
  process.stdout.write(`[vod:encode] ${line}\n`);
}
