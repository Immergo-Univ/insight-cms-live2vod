import axios from "axios";
import { config } from "../config.js";

export async function fetchChannelsWithArchive({ accountId, tenantId }) {
  const filter = `accountId||$eq||${accountId};fields.archive||$eq||toBool(true)`;
  const url = `${config.insightApiBase}/cms/entity/channels/find`;

  const response = await axios.get(url, {
    params: { filter },
    headers: {
      "x-tenant-id": tenantId,
      Authorization: `Bearer ${config.insightAuthToken}`,
    },
  });

  return Array.isArray(response.data) ? response.data : [response.data];
}

export function mapChannelData(channel) {
  const previewHls = channel.hlsMaster || channel.hlsStream;
  const poster = channel.content?.find((c) => c.medium === "image");

  const epgEvents = (channel.epgObject?.events || []).map((ev) => ({
    title: ev.title || "",
    start: ev.start || "",
    end: ev.end || "",
  }));

  return {
    id: channel._id,
    accountId: channel.accountId,
    title: channel.title,
    hlsStream: channel.hlsStream || "",
    hlsMaster: channel.hlsMaster || "",
    preview: previewHls || "",
    posterUrl: poster?.downloadUrl || "",
    archive: channel.archive ?? false,
    epgEvents,
  };
}
