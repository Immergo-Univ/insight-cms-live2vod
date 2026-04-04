import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter, Route, Routes } from "react-router";
import { EditorPage } from "@/pages/editor";
import { Live2VodPage } from "@/pages/live2vod";
import { NotFound } from "@/pages/not-found";
import { ProcessingClipsPage } from "@/pages/processing-clips";
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
                    <RouteProvider>
                        <VodProcessingProvider>
                            <Routes>
                                <Route path="/" element={<Live2VodPage />} />
                                <Route path="/editor" element={<EditorPage />} />
                                <Route path="/processing-clips" element={<ProcessingClipsPage />} />
                                <Route path="*" element={<NotFound />} />
                            </Routes>
                        </VodProcessingProvider>
                    </RouteProvider>
                </BrowserRouter>
            </AccountSettingsProvider>
        </ThemeProvider>
    </StrictMode>,
);
