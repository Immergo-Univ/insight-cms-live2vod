import axios from "axios";
import { config } from "../config.js";

const REFRESH_INTERVAL_MS = 10 * 60_000;

let cachedSession = null;
let lastLoginAt = 0;

export async function ensureSession() {
  if (cachedSession && Date.now() - lastLoginAt < REFRESH_INTERVAL_MS) {
    return cachedSession;
  }

  const { username, password } = validateCredentials();

  console.log("[auth] Logging in to Insight API…");

  const response = await axios.post(
    `${config.insightApiBase}/cms/login`,
    { username, password },
    {
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json, text/plain, */*",
      },
    }
  );

  const data = response.data;

  if (!data?.token || typeof data.token !== "string") {
    throw new Error("Unexpected login response — no token found");
  }

  cachedSession = {
    token: data.token,
    accounts: data.accounts || [],
    customers: data.customers || [],
    allowedAccountIDs: data.allowedAccountIDs || [],
    allowedCustomers: data.allowedCustomers || [],
  };

  lastLoginAt = Date.now();

  console.log(
    `[auth] Session obtained — ${cachedSession.accounts.length} accounts, ` +
      `${cachedSession.customers.length} customers. Next refresh in 10 min.`
  );

  return cachedSession;
}

export async function getAuthToken() {
  const session = await ensureSession();
  return session.token;
}

export async function resolveTenant(tenantId) {
  const session = await ensureSession();

  let customer = session.customers.find((c) => c._id === tenantId);

  if (!customer) {
    customer = session.customers.find((c) => c.code === tenantId);
  }

  if (!customer) {
    console.error(
      `[auth] No customer found for tenantId "${tenantId}". ` +
        `Available codes: ${session.customers.map((c) => c.code).join(", ")}`
    );
    throw new Error(`No customer found for tenantId "${tenantId}"`);
  }

  const customerId = customer.customerId || customer._id;

  const account = session.accounts.find((a) => a.customerId === customerId);

  if (!account) {
    console.error(
      `[auth] Customer "${customer.title}" found (doc._id=${customer._id}, customerId=${customerId}), ` +
        `but no matching account. Available account customerIds: ` +
        session.accounts.map((a) => a.customerId).join(", ")
    );
    throw new Error(`No account found for customer "${customer.title}" (${customerId})`);
  }

  console.log(
    `[auth] Resolved tenantId="${tenantId}" → customer="${customer.title}" ` +
      `(customerId=${customerId}), accountId="${account._id}"`
  );

  return {
    accountId: account._id,
    customerId,
    customerCode: customer.code,
  };
}

export async function getSessionAccounts() {
  const session = await ensureSession();
  return session.accounts;
}

export async function getSessionCustomers() {
  const session = await ensureSession();
  return session.customers;
}

function validateCredentials() {
  const username = config.insightApiUsername;
  const password = config.insightApiPassword;

  if (!username || !password) {
    throw new Error(
      "Missing INSIGHT_API_USERNAME or INSIGHT_API_PASSWORD environment variables"
    );
  }

  return { username, password };
}
