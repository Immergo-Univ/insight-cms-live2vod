import axios from "axios";
import { config } from "../config.js";
import { getAuthToken } from "./auth.service.js";
import {
  getInsightEntityFindMeta,
  normalizeInsightEntityFindResults,
} from "../utils/insight-entity.util.js";

const PAGE_LIMIT = 100;

export async function fetchMainCategories({ accountId, tenantId }) {
  const filter = `accountId||$eq||${accountId}`;
  const url = `${config.insightApiBase}/cms/entity/mainCategory/find`;
  const authToken = await getAuthToken();
  const headers = {
    "x-tenant-id": tenantId,
    Authorization: `Bearer ${authToken}`,
    Accept: "application/json, text/plain, */*",
  };

  const allRows = [];
  let page = 1;

  while (true) {
    const response = await axios.get(url, {
      params: {
        filter,
        sort: "_id,DESC",
        limit: PAGE_LIMIT,
        page,
      },
      headers,
    });

    const batch = normalizeInsightEntityFindResults(response.data);
    allRows.push(...batch);

    const meta = getInsightEntityFindMeta(response.data);
    if (!meta || page >= meta.pageCount || batch.length < PAGE_LIMIT) break;
    page += 1;
  }

  return allRows;
}

export function mapMainCategoryData(row) {
  const id = row._id || row.id;
  const idStr = id ? String(id) : "";
  const title = row.title || row.name || row.label || row.classification || row.categoryName || idStr;

  return {
    id: idStr,
    title: String(title).trim(),
  };
}
