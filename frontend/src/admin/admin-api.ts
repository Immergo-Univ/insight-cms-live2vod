import axios, { type AxiosInstance } from "axios";

const TOKEN_KEY = "admin_jwt";

const client: AxiosInstance = axios.create({
  baseURL: "/api/admin",
  headers: { "Content-Type": "application/json" },
});

export function getAdminToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}

export function setAdminToken(token: string | null) {
  if (token) {
    localStorage.setItem(TOKEN_KEY, token);
    client.defaults.headers.common.Authorization = `Bearer ${token}`;
  } else {
    localStorage.removeItem(TOKEN_KEY);
    delete client.defaults.headers.common.Authorization;
  }
}

const existing = getAdminToken();
if (existing) {
  client.defaults.headers.common.Authorization = `Bearer ${existing}`;
}

export function getAdminClient(): AxiosInstance {
  return client;
}
