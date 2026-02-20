import axios from "axios";

export interface M3u8DateRange {
  startDate: string;
  endDate: string;
}

export async function getM3u8DateRange(hlsStream: string): Promise<M3u8DateRange> {
  const response = await axios.get<M3u8DateRange>("/api/m3u8/date-range", {
    params: { hlsStream },
  });
  return response.data;
}
