import axios, { AxiosError, AxiosInstance } from 'axios';

const API_BASE_URL = "https://insight-api-frankly.univtec.com";
const BFF_BASE_URL = "/api";

function getQueryParams() {
  const params = new URLSearchParams(window.location.search);
  return {
    accountId: params.get("accountId") || "",
    tenantId: params.get("tenantId") || "",
    authToken: params.get("authToken") || "",
  };
}

export interface ApiConfig {
  baseUrl: string;
  authToken: string;
  tenantId: string;
  accountId: string;
}

export interface BffConfig {
  baseUrl: string;
}

export class HttpClient {
  protected config: ApiConfig;
  protected bffConfig: BffConfig;
  protected client: AxiosInstance;
  protected bffClient: AxiosInstance;

  constructor() {
    const qp = getQueryParams();

    this.config = {
      baseUrl: API_BASE_URL,
      authToken: qp.authToken,
      tenantId: qp.tenantId,
      accountId: qp.accountId,
    };

    this.bffConfig = {
      baseUrl: BFF_BASE_URL,
    };

    this.client = axios.create({
      baseURL: this.config.baseUrl,
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${this.config.authToken}`,
        "x-tenant-id": this.config.tenantId,
      },
    });

    this.bffClient = axios.create({
      baseURL: this.bffConfig.baseUrl,
      headers: {
        "Content-Type": "application/json",
      },
    });
  }

  updateConfig(config: Partial<ApiConfig>): void {
    this.config = { ...this.config, ...config };

    if (config.baseUrl) {
      this.client.defaults.baseURL = config.baseUrl;
    }

    if (config.authToken) {
      this.client.defaults.headers.common['Authorization'] = `Bearer ${config.authToken}`;
    }

    if (config.tenantId) {
      this.client.defaults.headers.common['x-tenant-id'] = config.tenantId;
    }
  }

  getErrorMessage(error: unknown): string {
    if (axios.isAxiosError(error)) {
      const axiosError = error as AxiosError<{ message?: string; error?: string }>;

      if (axiosError.response?.data) {
        const data = axiosError.response.data;
        return data.message || data.error || axiosError.message;
      }

      if (axiosError.code === 'ECONNABORTED') {
        return 'Request timed out. Please try again.';
      }

      if (axiosError.code === 'ERR_NETWORK') {
        return 'Connection error. Please check that the server is available.';
      }

      return axiosError.message || 'Error communicating with the server';
    }

    if (error instanceof Error) {
      return error.message;
    }

    return 'An unknown error occurred';
  }

  getAccountId(): string {
    if (!this.config.accountId) {
      this.config.accountId = getQueryParams().accountId;
    }
    return this.config.accountId;
  }

  getTenantId(): string {
    if (!this.config.tenantId) {
      this.config.tenantId = getQueryParams().tenantId;
    }
    return this.config.tenantId;
  }

  getClient(): AxiosInstance {
    return this.client;
  }

  getBffClient(): AxiosInstance {
    return this.bffClient;
  }
}

export const httpClient = new HttpClient();
