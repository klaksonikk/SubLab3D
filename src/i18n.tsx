import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import type { AppLanguage } from './engine/types';

const LANGUAGE_STORAGE_KEY = 'sublab_language_v1';

interface I18nContextValue {
  lang: AppLanguage;
  setLang: (lang: AppLanguage) => void;
  toggleLang: () => void;
}

const I18nContext = createContext<I18nContextValue>({
  lang: 'pl',
  setLang: () => {},
  toggleLang: () => {},
});

function detectInitialLanguage(): AppLanguage {
  if (typeof window === 'undefined') return 'pl';
  try {
    const urlLang = new URLSearchParams(window.location.search).get('lang');
    if (urlLang === 'en' || urlLang === 'pl') return urlLang;
    const saved = window.localStorage.getItem(LANGUAGE_STORAGE_KEY);
    if (saved === 'en' || saved === 'pl') return saved;
  } catch {
    // Ignore storage access errors
  }
  return 'pl';
}

export function LanguageProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<AppLanguage>(() => detectInitialLanguage());

  useEffect(() => {
    try {
      window.localStorage.setItem(LANGUAGE_STORAGE_KEY, lang);
    } catch {
      // Ignore storage access errors
    }
    if (typeof document !== 'undefined') {
      document.documentElement.lang = lang;
      document.title =
        lang === 'en'
          ? 'SubLab 3D — Subwoofer Enclosure CAD & T-S Lab'
          : 'SubLab 3D — Projektant Obudów Basowych';
    }
  }, [lang]);

  const setLang = (next: AppLanguage) => setLangState(next);
  const toggleLang = () => setLangState((prev) => (prev === 'pl' ? 'en' : 'pl'));

  return (
    <I18nContext.Provider value={{ lang, setLang, toggleLang }}>
      {children}
    </I18nContext.Provider>
  );
}

export function useI18n(): I18nContextValue {
  return useContext(I18nContext);
}

export function formatDecimal(value: number, decimals: number, lang: AppLanguage): string {
  const fixed = value.toFixed(decimals);
  return lang === 'pl' ? fixed.replace('.', ',') : fixed;
}
