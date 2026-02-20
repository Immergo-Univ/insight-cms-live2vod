import { Router } from "express";
import { fetchM3u8DateRange } from "../services/m3u8.service.js";

export const m3u8Router = Router();

m3u8Router.get("/date-range", async (req, res) => {
  try {
    const { hlsStream } = req.query;

    if (!hlsStream) {
      return res.status(400).json({ error: "Missing required query parameter: hlsStream" });
    }

    const range = await fetchM3u8DateRange(hlsStream);
    res.json(range);
  } catch (error) {
    const status = error.response?.status || 500;
    const message = error.response?.data?.message || error.message;
    res.status(status).json({ error: message });
  }
});
