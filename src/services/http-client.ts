import axios, { AxiosError, AxiosInstance } from 'axios';

/**
 * Configuración de la API
 */
export interface ApiConfig {
  baseUrl: string;
  authToken: string;
  tenantId: string;
  accountId: string;
}

/**
 * Configuración del BFF (Backend For Frontend)
 */
export interface BffConfig {
  baseUrl: string;
}

/**
 * Cliente HTTP base que centraliza la configuración y métodos comunes
 * para todos los servicios de la aplicación
 */
export class HttpClient {
  protected config: ApiConfig;
  protected bffConfig: BffConfig;
  protected client: AxiosInstance;
  protected bffClient: AxiosInstance;

  constructor(config?: Partial<ApiConfig>, bffConfig?: Partial<BffConfig>) {
    // Configuración desde variables de entorno o valores por defecto
    this.config = {
      baseUrl: config?.baseUrl || import.meta.env.VITE_API_BASE_URL || "https://insight-api-stg.univtec.com",
      authToken: config?.authToken || import.meta.env.VITE_AUTH_TOKEN || "",
      tenantId: config?.tenantId || import.meta.env.VITE_TENANT_ID || "",
      accountId: config?.accountId || import.meta.env.VITE_ACCOUNT_ID || "",
    };

    this.bffConfig = {
      baseUrl: bffConfig?.baseUrl || import.meta.env.VITE_BFF_BASE_URL || "http://localhost:3001",
    };

    // Validar variables críticas en desarrollo
    if (import.meta.env.DEV) {
      this.validateConfig();
    }

    // Cliente para la API (solo para POST/PUT cuando sea necesario)
    this.client = axios.create({
      baseURL: this.config.baseUrl,
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${this.config.authToken}`,
        "x-tenant-id": this.config.tenantId,
      },
    });

    // Cliente para el BFF (para GET y operaciones CRUD)
    this.bffClient = axios.create({
      baseURL: this.bffConfig.baseUrl,
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${this.config.authToken}`,
        "x-tenant-id": this.config.tenantId,
      },
    });
  }

  /**
   * Actualiza la configuración de la API
   */
  updateConfig(config: Partial<ApiConfig>): void {
    this.config = { ...this.config, ...config };
    
    if (config.baseUrl) {
      this.client.defaults.baseURL = config.baseUrl;
    }
    
    if (config.authToken) {
      this.client.defaults.headers.common['Authorization'] = `Bearer ${config.authToken}`;
      this.bffClient.defaults.headers.common['Authorization'] = `Bearer ${config.authToken}`;
    }
    
    if (config.tenantId) {
      this.client.defaults.headers.common['x-tenant-id'] = config.tenantId;
      this.bffClient.defaults.headers.common['x-tenant-id'] = config.tenantId;
    }
  }

  /**
   * Actualiza la configuración del BFF
   */
  updateBffConfig(bffConfig: Partial<BffConfig>): void {
    this.bffConfig = { ...this.bffConfig, ...bffConfig };
    
    if (bffConfig.baseUrl) {
      this.bffClient.defaults.baseURL = bffConfig.baseUrl;
    }
  }

  /**
   * Obtiene un mensaje de error legible desde cualquier tipo de error
   */
  getErrorMessage(error: unknown): string {
    if (axios.isAxiosError(error)) {
      const axiosError = error as AxiosError<{ message?: string; error?: string }>;
      
      if (axiosError.response?.data) {
        const data = axiosError.response.data;
        return data.message || data.error || axiosError.message;
      }
      
      if (axiosError.code === 'ECONNABORTED') {
        return 'La solicitud tardó demasiado. Por favor, intenta nuevamente.';
      }
      
      if (axiosError.code === 'ERR_NETWORK') {
        return 'Error de conexión. Verifica que el servidor esté disponible.';
      }
      
      return axiosError.message || 'Error al comunicarse con el servidor';
    }
    
    if (error instanceof Error) {
      return error.message;
    }
    
    return 'Ocurrió un error desconocido';
  }

  /**
   * Obtiene el accountId de la configuración
   */
  getAccountId(): string {
    return this.config.accountId;
  }

  /**
   * Obtiene el tenantId de la configuración
   */
  getTenantId(): string {
    return this.config.tenantId;
  }

  /**
   * Obtiene el cliente de la API (para POST/PUT directos a la API)
   */
  getClient(): AxiosInstance {
    return this.client;
  }

  /**
   * Obtiene el cliente del BFF (para GET y operaciones CRUD)
   */
  getBffClient(): AxiosInstance {
    return this.bffClient;
  }

  /**
   * Valida que las variables de entorno críticas estén configuradas
   * Solo se ejecuta en modo desarrollo
   */
  private validateConfig(): void {
    const missingVars: string[] = [];

    if (!this.config.authToken) {
      missingVars.push('VITE_AUTH_TOKEN');
    }
    if (!this.config.tenantId) {
      missingVars.push('VITE_TENANT_ID');
    }
    if (!this.config.accountId) {
      missingVars.push('VITE_ACCOUNT_ID');
    }

    if (missingVars.length > 0) {
      console.warn(
        `⚠️  Variables de entorno faltantes: ${missingVars.join(', ')}\n` +
        `Por favor, crea un archivo .env en la raíz del proyecto con estas variables.\n` +
        `Puedes usar .env.example como referencia.`
      );
    }
  }
}

/**
 * Instancia singleton del cliente HTTP base
 * Todos los servicios pueden usar esta instancia compartida
 */
export const httpClient = new HttpClient();

