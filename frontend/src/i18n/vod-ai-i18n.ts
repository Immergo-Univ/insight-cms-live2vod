import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import en from "./locales/vod-ai-en.json";
import es from "./locales/vod-ai-es.json";

export const VOD_AI_LANG_KEY = "vod_ai_lang";

/**
 * Isolated i18n instance for the embeddable AI Content page (`/vod/:vod_guid`).
 * Language resolves from `?lang=es|en`, then localStorage, then the browser, then English.
 */
function getInitialLang(): "es" | "en" {
  try {
    const q = new URLSearchParams(window.location.search).get("lang");
    if (q === "es" || q === "en") return q;
    const stored = localStorage.getItem(VOD_AI_LANG_KEY);
    if (stored === "es" || stored === "en") return stored;
    if (navigator.language?.toLowerCase().startsWith("es")) return "es";
  } catch {
    // ignore
  }
  return "en";
}

export function setVodAiLang(lng: "es" | "en") {
  try {
    localStorage.setItem(VOD_AI_LANG_KEY, lng);
  } catch {
    // ignore
  }
  void vodAiI18n.changeLanguage(lng);
}

const vodAiI18n = i18n.createInstance();

void vodAiI18n.use(initReactI18next).init({
  lng: getInitialLang(),
  fallbackLng: "en",
  ns: ["vodAi"],
  defaultNS: "vodAi",
  interpolation: { escapeValue: false },
  resources: {
    en: { vodAi: en },
    es: { vodAi: es },
  },
});

export default vodAiI18n;
