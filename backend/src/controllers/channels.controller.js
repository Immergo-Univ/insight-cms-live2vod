import { Router } from "express";
import { fetchChannelsWithArchive, mapChannelData } from "../services/channels.service.js";
import { resolveTenant } from "../services/auth.service.js";
import { getRequestTenantId } from "../utils/tenant-cipher.js";

export const channelsRouter = Router();

channelsRouter.get("/", async (req, res) => {
  try {
    const tenantId = getRequestTenantId(req);

    if (!tenantId) {
      return res.status(400).json({
        error: "Missing required query parameter: tenantId",
      });
    }

    const { accountId, tenantId: resolvedTenantId } = await resolveTenant(tenantId);

    console.log(`[channels] tenantId="${resolvedTenantId}" → accountId="${accountId}"`);

    const rawChannels = await fetchChannelsWithArchive({ accountId, tenantId: resolvedTenantId });

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
