import React, { createContext, useCallback, useContext, useMemo, useState } from 'react';
import en from './translations/en.json';
import th from './translations/th.json';
import it from './translations/it.json';
import zh from './translations/zh.json';
import { getInitialPreferences, savePreferences } from '../services/admin';

type Locale = 'en' | 'th' | 'it' | 'zh';
type Translations = Record<string, string>;

const STORAGE_KEY = 'locale';
const translations: Record<Locale, Translations> = { en, th, it, zh };

type I18nContextValue = {
  locale: Locale;
  /** [FEAT-20261022-I18NTICKETEN] true under I18nProvider; the bare default context (isolated
      renders) says false, so a `locale === 'en'` branch can ask `isEnglish` instead and keep Thai */
  isEnglish: boolean;
  setLocale: (locale: Locale) => void;
  t: (
    key: string,
    fallbackOrVars?: string | Record<string, unknown>,
    vars?: Record<string, unknown>,
  ) => string;
};

const I18nContext = createContext<I18nContextValue>({
  locale: 'en',
  isEnglish: false,
  setLocale: () => {},
  // no provider (isolated renders/tests): the fallback text, placeholders filled like the real `t`
  t: (key, fallbackOrVars, vars) =>
    typeof fallbackOrVars === 'string' ? interpolate(fallbackOrVars, vars) : key
});

const isLocale = (v: any): v is Locale => v === 'en' || v === 'th' || v === 'it' || v === 'zh';

const getStoredLocale = (): Locale => {
  if (typeof window === 'undefined') return 'th';
  // DB preference first (syncs across devices), then localStorage cache, then th.
  const fromPrefs = getInitialPreferences()?.ui?.locale;
  if (isLocale(fromPrefs)) return fromPrefs;
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    if (isLocale(stored)) return stored;
  } catch { /* ignore */ }
  return 'th';
};

const interpolate = (template: string, vars?: Record<string, unknown>) => {
  if (!vars) return template;
  return template.replace(/\{(\w+)\}/g, (match, key) => {
    const value = vars[key];
    return value === undefined || value === null ? match : String(value);
  });
};

/* [FEAT-20261022-I18NTICKETEN] the locale the provider is showing, for plain .ts helpers that
   build a label outside React (no hook available). Components keep using `useI18n().t`. */
let activeLocale: Locale = 'th';

/** Translate outside React — same resolution as `t` (locale → en → fallback → key). */
export const translateNow = (key: string, fallback?: string, vars?: Record<string, unknown>): string => {
  const current = translations[activeLocale]?.[key];
  const resolved = current && current.trim() ? current : translations.en?.[key] || fallback || key;
  return interpolate(resolved, vars);
};

export const I18nProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [locale, setLocaleState] = useState<Locale>(getStoredLocale);
  activeLocale = locale; // kept in step on every render (see translateNow)

  // Apply the DB locale when preferences load (login on a fresh browser), so
  // the language follows the account without a manual refresh.
  React.useEffect(() => {
    const resync = () => {
      const fromPrefs = getInitialPreferences()?.ui?.locale;
      if (isLocale(fromPrefs)) setLocaleState(fromPrefs);
    };
    window.addEventListener('preferences:updated', resync);
    return () => window.removeEventListener('preferences:updated', resync);
  }, []);

  const setLocale = useCallback((nextLocale: Locale) => {
    setLocaleState(nextLocale);
    try {
      window.localStorage.setItem(STORAGE_KEY, nextLocale); // fast local cache
    } catch {
      // Ignore storage write failures.
    }
    // Persist to the DB so the choice follows the user across devices. Fire and
    // forget — the local state/cache already updated, a failed save re-syncs
    // on the next change and never blocks the UI.
    savePreferences({ ui: { locale: nextLocale } }).catch(() => {});
  }, []);

  const t = useCallback(
    (
      key: string,
      fallbackOrVars?: string | Record<string, unknown>,
      vars?: Record<string, unknown>,
    ) => {
      const defaultText = typeof fallbackOrVars === 'string' ? fallbackOrVars : undefined;
      const actualVars = typeof fallbackOrVars === 'object' && fallbackOrVars !== null ? fallbackOrVars : vars;
      const current = translations[locale]?.[key];
      const fallback = translations.en?.[key];
      const resolved = current && current.trim() ? current : fallback || defaultText || key;
      return interpolate(resolved, actualVars);
    },
    [locale]
  );

  const value = useMemo<I18nContextValue>(
    () => ({ locale, isEnglish: locale === 'en', setLocale, t }),
    [locale, setLocale, t],
  );

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
};

export const useI18n = () => useContext(I18nContext);
