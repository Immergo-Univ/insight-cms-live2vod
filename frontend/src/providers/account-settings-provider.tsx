import type { ReactNode } from "react";
import { createContext, useContext, useEffect, useState } from "react";
import { accountSettingsService, AccountSettings } from "@/services/account-settings.service";
import { httpClient } from "@/services/http-client";

interface AccountSettingsContextType {
  accountSettings: AccountSettings | null;
  loading: boolean;
  error: string | null;
}

const AccountSettingsContext = createContext<AccountSettingsContextType | undefined>(undefined);

export const useAccountSettings = (): AccountSettingsContextType => {
  const context = useContext(AccountSettingsContext);

  if (context === undefined) {
    throw new Error("useAccountSettings must be used within an AccountSettingsProvider");
  }

  return context;
};

interface AccountSettingsProviderProps {
  children: ReactNode;
}

/**
 * AccountSettingsProvider
 * 
 * Este provider:
 * 1. Carga la configuración de la cuenta desde la API
 * 2. Aplica el color del cliente como CSS variables
 * 3. Sobrescribe las variables de brand para que los componentes usen el color del cliente
 * 
 * IMPORTANTE: Este provider afecta los ESTILOS del cliente (colores, branding)
 * No afecta el tema light/dark (eso lo hace ThemeProvider)
 */
export const AccountSettingsProvider = ({ children }: AccountSettingsProviderProps) => {
  const [accountSettings, setAccountSettings] = useState<AccountSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Aplicar color neutral por defecto mientras carga para evitar el flash violeta
  useEffect(() => {
    const root = document.documentElement;
    // Color neutral gris/negro mientras carga el color real
    root.style.setProperty('--color-brand-600', 'rgb(75 85 99)'); // gray-600 neutral
    root.style.setProperty('--color-brand-700', 'rgb(55 65 81)'); // gray-700
    root.style.setProperty('--color-brand-100', 'rgb(243 244 246)'); // gray-100 neutral (en lugar de purple-100)
    root.style.setProperty('--color-bg-brand-solid', 'rgb(75 85 99)');
    root.style.setProperty('--color-border-brand', 'rgb(75 85 99)');
    root.style.setProperty('--color-fg-brand-primary', 'rgb(75 85 99)');
    root.style.setProperty('--color-text-brand-secondary', 'rgb(75 85 99)');
  }, []);

  // Cargar account settings desde la API
  useEffect(() => {
    const loadAccountSettings = async () => {
      setLoading(true);
      setError(null);
      try {
        const accountId = httpClient.getAccountId();
        const settings = await accountSettingsService.getAccountSettings(accountId);
        setAccountSettings(settings);
      } catch (err) {
        console.error("Error loading account settings:", err);
        setError(err instanceof Error ? err.message : "Error al cargar account settings");
      } finally {
        setLoading(false);
      }
    };

    loadAccountSettings();
  }, []);

  // Aplicar el color del cliente como CSS variables
  // Sobrescribir las variables de brand para usar el color del cliente
  useEffect(() => {
    if (accountSettings?.color) {
      const root = document.documentElement;
      const clientColor = accountSettings.color;
      
      // Aplicar el color como CSS variable para uso general
      root.style.setProperty('--client-primary-color', clientColor);
      root.style.setProperty('--primary-color', clientColor);
      
      // Sobrescribir las variables de brand para que usen el color del cliente
      // Esto hará que todos los componentes que usan bg-brand-solid, text-brand, etc.
      // usen el color del cliente automáticamente
      root.style.setProperty('--color-brand-600', clientColor);
      root.style.setProperty('--color-brand-700', clientColor);
      root.style.setProperty('--color-bg-brand-solid', clientColor);
      root.style.setProperty('--color-border-brand', clientColor);
      root.style.setProperty('--color-fg-brand-primary', clientColor);
      root.style.setProperty('--color-text-brand-secondary', clientColor);
      
      // Calcular variaciones del color para hover states y fondos claros
      try {
        const colorHex = clientColor.replace('#', '');
        const r = parseInt(colorHex.slice(0, 2), 16);
        const g = parseInt(colorHex.slice(2, 4), 16);
        const b = parseInt(colorHex.slice(4, 6), 16);
        
        // Oscurecer un 10% para hover
        const hoverR = Math.max(0, Math.floor(r * 0.9));
        const hoverG = Math.max(0, Math.floor(g * 0.9));
        const hoverB = Math.max(0, Math.floor(b * 0.9));
        const hoverColor = `rgb(${hoverR} ${hoverG} ${hoverB})`;
        
        root.style.setProperty('--color-brand-700', hoverColor);
        root.style.setProperty('--color-bg-brand-solid_hover', hoverColor);
        
        // Aclarar para fondo claro (aumentar luminosidad mezclando con blanco ~90%)
        const lightR = Math.min(255, Math.floor(r + (255 - r) * 0.9));
        const lightG = Math.min(255, Math.floor(g + (255 - g) * 0.9));
        const lightB = Math.min(255, Math.floor(b + (255 - b) * 0.9));
        const lightColor = `rgb(${lightR} ${lightG} ${lightB})`;
        
        root.style.setProperty('--color-brand-100', lightColor);
      } catch (e) {
        // Si falla el cálculo, usar el mismo color
        root.style.setProperty('--color-bg-brand-solid_hover', clientColor);
        root.style.setProperty('--color-brand-100', 'rgb(243 244 246)'); // fallback a gray-100 (en lugar de purple-100)
      }
    }
  }, [accountSettings]);

  return (
    <AccountSettingsContext.Provider value={{ accountSettings, loading, error }}>
      {children}
    </AccountSettingsContext.Provider>
  );
};

