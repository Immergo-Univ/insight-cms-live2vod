/**
 * Resolves a tenant's primary S3-compatible storage credentials from insight-api,
 * so they can be forwarded to the editorial encoder per job (instead of relying on
 * a single static bucket configured on the encoder).
 *
 * Mirrors insight-api's StorageService.getCustomProvider resolution for the
 * s3 / wasabi / digitalocean providers: the bucket + endpoint live in
 * `accountSettings.storageProviders[]` and the credentials live in the `secrets`
 * collection (type s3_storage | wasabi_storage | digitalocean_storage).
 */

import axios from "axios";
import { config } from "../config.js";
import { getAuthToken } from "./auth.service.js";

const S3_PROVIDERS = new Set(["s3", "wasabi", "digitalocean"]);

/** insight-api secret type for a given storage provider. */
function secretTypeForProvider(provider) {
  if (provider === "wasabi") return "wasabi_storage";
  if (provider === "digitalocean") return "digitalocean_storage";
  return "s3_storage";
}

async function entityFind(entityType, accountId, tenantId) {
  const url = `${config.insightApiBase}/cms/entity/${entityType}/find`;
  const filter = `accountId||$eq||${accountId}`;
  const authToken = await getAuthToken();

  const response = await axios.get(url, {
    params: { filter },
    headers: {
      "x-tenant-id": tenantId,
      Authorization: `Bearer ${authToken}`,
    },
  });

  const data = response.data;
  return Array.isArray(data) ? data : data ? [data] : [];
}

/** Flatten secretData [{key,value}] into a plain object. */
function parseSecretData(secret) {
  const out = {};
  for (const entry of secret?.secretData || []) {
    if (entry && typeof entry.key === "string") out[entry.key] = entry.value;
  }
  return out;
}

/**
 * @param {object} opts
 * @param {string} opts.accountId
 * @param {string} opts.tenantId
 * @returns {Promise<{bucket:string,key:string,secret:string,hostname:string,cdnBase:string,provider:string}|null>}
 *   Resolved S3 destination, or null when the tenant has no usable S3-family storage.
 */
export async function resolveTenantS3({ accountId, tenantId }) {
  if (!accountId || !tenantId) return null;

  const [accountSettings] = await entityFind("accountSettings", accountId, tenantId);
  const providers = accountSettings?.storageProviders;
  if (!Array.isArray(providers) || providers.length === 0) return null;

  const primary = providers.find((p) => p?.primary) || providers[0];
  const provider = primary?.provider;
  if (!S3_PROVIDERS.has(provider)) return null;

  const secrets = await entityFind("secrets", accountId, tenantId);
  const providerSecret = secrets.find(
    (s) => s?.type === secretTypeForProvider(provider),
  );
  if (!providerSecret) return null;

  // keyName = access key id, key = secret access key (insight-api convention).
  const { keyName, key } = parseSecretData(providerSecret);
  const bucket = primary.folderOrBucket ?? primary.foldersOrBuckets?.[0];

  if (!bucket || !keyName || !key) return null;

  // Legacy createClip uses customerCode unless storage provider overrides the folder.
  const customerFolder =
    primary.useProviderBucket && primary.folderOrBucket
      ? String(primary.folderOrBucket)
      : tenantId;

  return {
    bucket,
    key: keyName,
    secret: key,
    hostname: primary.hostname || "",
    cdnBase: primary.distributionUrl || "",
    provider,
    customerFolder,
  };
}
