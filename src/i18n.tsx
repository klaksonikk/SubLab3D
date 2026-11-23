import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import type { AppLanguage, UnitSystem } from './engine/types';

const LANGUAGE_STORAGE_KEY = 'sublab_language_v1';
const UNIT_STORAGE_KEY = 'sublab_units_v1';

interface I18nContextValue {
  lang: AppLanguage;
  setLang: (lang: AppLanguage) => void;
  toggleLang: () => void;
  unitSystem: UnitSystem;
  setUnitSystem: (unitSystem: UnitSystem) => void;
  toggleUnitSystem: () => void;
}

const I18nContext = createContext<I18nContextValue>({
  lang: 'pl',
  setLang: () => {},
  toggleLang: () => {},
  unitSystem: 'metric',
  setUnitSystem: () => {},
  toggleUnitSystem: () => {},
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

function detectInitialUnitSystem(): UnitSystem {
  if (typeof window === 'undefined') return 'metric';
  try {
    const urlUnits = new URLSearchParams(window.location.search).get('units');
    if (urlUnits === 'imperial' || urlUnits === 'metric') return urlUnits;
    const saved = window.localStorage.getItem(UNIT_STORAGE_KEY);
    if (saved === 'imperial' || saved === 'metric') return saved;
  } catch {
    // Ignore storage access errors
  }
  return 'metric';
}

export function LanguageProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<AppLanguage>(() => detectInitialLanguage());
  const [unitSystem, setUnitSystemState] = useState<UnitSystem>(() => detectInitialUnitSystem());

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

  useEffect(() => {
    try {
      window.localStorage.setItem(UNIT_STORAGE_KEY, unitSystem);
    } catch {
      // Ignore storage access errors
    }
  }, [unitSystem]);

  const setLang = (next: AppLanguage) => setLangState(next);
  const toggleLang = () => setLangState((prev) => (prev === 'pl' ? 'en' : 'pl'));
  const setUnitSystem = (next: UnitSystem) => setUnitSystemState(next);
  const toggleUnitSystem = () =>
    setUnitSystemState((prev) => (prev === 'metric' ? 'imperial' : 'metric'));

  return (
    <I18nContext.Provider
      value={{ lang, setLang, toggleLang, unitSystem, setUnitSystem, toggleUnitSystem }}
    >
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

