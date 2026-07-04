import { Router } from "express";
import { clearChannelAdsSnapshot } from "../services/channel-ads-disk.service.js";
import { deleteChannelAdsBackupObject } from "../services/s3-logos.service.js";

export const channelSettingsRouter = Router();

/**
 * Remove precalculated ads + live probe snapshot for this channel (local JSON and S3 backup if configured).
 * Logo template management was removed together with the OpenCV logo-detector pipeline; ad windows are now
 * produced by the AD recognition scheduler (see ad-recognition.service.js).
 */
channelSettingsRouter.delete("/:channelId/settings/ads-snapshot", async (req, res) => {
  try {
    const channelId = req.params.channelId;
    const { localExisted } = await clearChannelAdsSnapshot(channelId);
    let s3 = { skipped: true };
    try {
      s3 = await deleteChannelAdsBackupObject(channelId);
    } catch (e) {
      return res.status(500).json({ error: `S3 delete failed: ${e.message}` });
    }
    res.json({
      ok: true,
      localRemoved: localExisted,
      s3: s3.skipped ? { skipped: true } : { deleted: Boolean(s3.deleted) },
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});
