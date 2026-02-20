import axios from "axios";

const DATE_TAG = "#EXT-X-PROGRAM-DATE-TIME:";

export async function fetchM3u8DateRange(hlsStreamUrl) {
  const response = await axios.get(hlsStreamUrl, { responseType: "text" });
  const text = response.data;

  let firstDate = null;
  let lastDate = null;

  let searchFrom = 0;
  const firstIdx = text.indexOf(DATE_TAG, searchFrom);
  if (firstIdx !== -1) {
    const lineEnd = text.indexOf("\n", firstIdx);
    const raw = text.substring(firstIdx + DATE_TAG.length, lineEnd).trim();
    firstDate = raw;
  }

  const lastIdx = text.lastIndexOf(DATE_TAG);
  if (lastIdx !== -1) {
    const lineEnd = text.indexOf("\n", lastIdx);
    const raw = text.substring(lastIdx + DATE_TAG.length, lineEnd === -1 ? undefined : lineEnd).trim();
    lastDate = raw;
  }

  if (!firstDate || !lastDate) {
    throw new Error("No EXT-X-PROGRAM-DATE-TIME tags found in m3u8");
  }

  return {
    startDate: new Date(firstDate).toISOString(),
    endDate: new Date(lastDate).toISOString(),
  };
}
