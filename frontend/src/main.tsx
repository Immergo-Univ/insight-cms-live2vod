import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter, Route, Routes } from "react-router";
import { EditorPage } from "@/pages/editor";
import { Live2VodPage } from "@/pages/live2vod";
import { NotFound } from "@/pages/not-found";
import { ProcessingClipsPage } from "@/pages/processing-clips";
import { AdminApp } from "@/admin/admin-app";
import { TenantSettingsProvider } from "@/providers/tenant-settings-provider";
import { RouteProvider } from "@/providers/router-provider";
import { VodProcessingProvider } from "@/providers/vod-processing-provider";
import { ThemeProvider } from "@/providers/theme-provider";
import { AccountSettingsProvider } from "@/providers/account-settings-provider";
import "@/styles/globals.css";

createRoot(document.getElementById("root")!).render(
    <StrictMode>
        <ThemeProvider>
            <AccountSettingsProvider>
                <BrowserRouter>
                    <TenantSettingsProvider>
                    <RouteProvider>
                        <VodProcessingProvider>
                            <Routes>
                                <Route path="/" element={<Live2VodPage />} />
                                <Route path="/editor" element={<EditorPage />} />
                                <Route path="/processing-clips" element={<ProcessingClipsPage />} />
                                <Route path="/admin/*" element={<AdminApp />} />
                                <Route path="*" element={<NotFound />} />
                            </Routes>
                        </VodProcessingProvider>
                    </RouteProvider>
                    </TenantSettingsProvider>
                </BrowserRouter>
            </AccountSettingsProvider>
        </ThemeProvider>
    </StrictMode>,
);
