import axios, { AxiosError, AxiosInstance } from 'axios';

const API_BASE_URL = "https://insight-api-frankly.univtec.com";
const BFF_BASE_URL = "/api";

function getQueryParams() {
  const params = new URLSearchParams(window.location.search);
  return {
    tenantId: params.get("tenantId") || "",
  };
}

export interface ApiConfig {
  baseUrl: string;
  tenantId: string;
  accountId: string;
}

export interface BffConfig {
  baseUrl: string;
}

interface AuthContext {
  tenantId: string;
  accountId: string;
  accounts: Array<{ _id: string; title: string; customerId: string }>;
  customers: Array<{ _id: string; title: string; code: string }>;
}

export class HttpClient {
  protected config: ApiConfig;
  protected bffConfig: BffConfig;
  protected client: AxiosInstance;
  protected bffClient: AxiosInstance;
  private authContextPromise: Promise<AuthContext> | null = null;

  constructor() {
    const qp = getQueryParams();

    this.config = {
      baseUrl: API_BASE_URL,
      tenantId: qp.tenantId,
      accountId: "",
    };

    this.bffConfig = {
      baseUrl: BFF_BASE_URL,
    };

    this.client = axios.create({
      baseURL: this.config.baseUrl,
      headers: {
        "Content-Type": "application/json",
        "x-tenant-id": this.config.tenantId,
      },
    });

    this.bffClient = axios.create({
      baseURL: this.bffConfig.baseUrl,
      headers: {
        "Content-Type": "application/json",
        "x-tenant-id": this.config.tenantId,
      },
    });
  }

  updateConfig(config: Partial<ApiConfig>): void {
    this.config = { ...this.config, ...config };

    if (config.baseUrl) {
      this.client.defaults.baseURL = config.baseUrl;
    }

    if (config.tenantId) {
      this.client.defaults.headers.common['x-tenant-id'] = config.tenantId;
      this.bffClient.defaults.headers.common['x-tenant-id'] = config.tenantId;
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

  async fetchAuthContext(): Promise<AuthContext> {
    if (!this.authContextPromise) {
      this.authContextPromise = this.bffClient
        .get<AuthContext>("/auth/context", {
          params: { tenantId: this.config.tenantId },
        })
        .then((res) => {
          this.config.accountId = res.data.accountId;
          return res.data;
        });
    }
    return this.authContextPromise;
  }

  async getAccountId(): Promise<string> {
    if (this.config.accountId) {
      return this.config.accountId;
    }
    const ctx = await this.fetchAuthContext();
    return ctx.accountId;
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
