import { Router } from "express";
import { fetchChannelsWithArchive, mapChannelData } from "../services/channels.service.js";

export const channelsRouter = Router();

channelsRouter.get("/", async (req, res) => {
  try {
    const accountId = req.query.accountId;
    const tenantId = req.query.tenantId || req.headers["x-tenant-id"];

    if (!accountId || !tenantId) {
      return res.status(400).json({
        error: "Missing required query parameters: accountId, tenantId",
      });
    }

    const rawChannels = await fetchChannelsWithArchive({ accountId, tenantId });

    rawChannels.forEach((ch) => {
      const evCount = ch.epgObject?.events?.length ?? 0;
      console.log(`[channels] "${ch.title}" — epgObject.events: ${evCount}`);
    });

    const channels = rawChannels.map(mapChannelData);

    res.json(channels);
  } catch (error) {
    const status = error.response?.status || 500;
    const message = error.response?.data?.message || error.message;
    res.status(status).json({ error: message });
  }
});
