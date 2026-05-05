import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import adminEn from "./locales/admin-en.json";
import adminEs from "./locales/admin-es.json";

const ADMIN_LANG_KEY = "admin_lang";

export function getStoredAdminLang(): string {
  return localStorage.getItem(ADMIN_LANG_KEY) || "es";
}

export function setStoredAdminLang(lng: string) {
  localStorage.setItem(ADMIN_LANG_KEY, lng);
  void i18n.changeLanguage(lng);
}

void i18n.use(initReactI18next).init({
  lng: getStoredAdminLang(),
  fallbackLng: "en",
  ns: ["admin"],
  defaultNS: "admin",
  interpolation: { escapeValue: false },
  resources: {
    en: { admin: adminEn },
    es: { admin: adminEs },
  },
});

export default i18n;
