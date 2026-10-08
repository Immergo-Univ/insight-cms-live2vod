import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import en from "./locales/vod-editor-en.json";
import es from "./locales/vod-editor-es.json";

/**
 * App-level i18n instance for the embeddable VOD editor page (isolated from the
 * admin i18n instance). Language resolves from `?lang=es|en`, then localStorage,
 * then falls back to English.
 */
function getInitialLang(): "es" | "en" {
  try {
    const q = new URLSearchParams(window.location.search).get("lang");
    if (q === "es" || q === "en") return q;
    const stored = localStorage.getItem("vod_editor_lang");
    if (stored === "es" || stored === "en") return stored;
  } catch {
    // ignore
  }
  return "en";
}

const vodEditorI18n = i18n.createInstance();

void vodEditorI18n.use(initReactI18next).init({
  lng: getInitialLang(),
  fallbackLng: "en",
  ns: ["vodEditor"],
  defaultNS: "vodEditor",
  interpolation: { escapeValue: false },
  resources: {
    en: { vodEditor: en },
    es: { vodEditor: es },
  },
});

export default vodEditorI18n;
