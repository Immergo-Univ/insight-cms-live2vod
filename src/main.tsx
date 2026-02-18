import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter, Route, Routes } from "react-router";
import { HomeScreen } from "@/pages/home-screen";
import { NotFound } from "@/pages/not-found";
import { RouteProvider } from "@/providers/router-provider";
import { ThemeProvider } from "@/providers/theme-provider";
import { AccountSettingsProvider } from "@/providers/account-settings-provider";
import "@/styles/globals.css";

/**
 * Estructura de Providers:
 * 
 * ThemeProvider
 *  └─ Afecta: Tema light/dark del sistema
 *  └─ Aplica: Clases CSS para modo oscuro/claro
 * 
 * AccountSettingsProvider
 *  └─ Afecta: Estilos del cliente (colores, branding)
 *  └─ Aplica: CSS variables con color del cliente
 *  └─ Sobrescribe: Variables de brand (--color-brand-600, etc.)
 * 
 * BrowserRouter + RouteProvider
 *  └─ Afecta: Navegación y routing
 */
createRoot(document.getElementById("root")!).render(
    <StrictMode>
        <ThemeProvider>
            <AccountSettingsProvider>
                <BrowserRouter>
                    <RouteProvider>
                        <Routes>
                            <Route path="/" element={<HomeScreen />} />
                            <Route path="*" element={<NotFound />} />
                        </Routes>
                    </RouteProvider>
                </BrowserRouter>
            </AccountSettingsProvider>
        </ThemeProvider>
    </StrictMode>,
);
