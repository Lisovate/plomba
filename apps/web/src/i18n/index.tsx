import { createContext, type ReactNode, useCallback, useContext, useMemo, useState } from 'react';
import { en, type MessageKey, type Messages } from './en.ts';
import { pl } from './pl.ts';

export type Language = 'en' | 'pl';

const DICTIONARIES: Record<Language, Messages> = { en, pl };
const STORAGE_KEY = 'plomba.language';

export type Translate = (key: MessageKey, vars?: Record<string, string | number>) => string;

/** Replaces `{name}` placeholders. Unknown placeholders are left visible so they get noticed. */
export function format(template: string, vars?: Record<string, string | number>): string {
  if (!vars) return template;
  return template.replace(/\{(\w+)\}/g, (match, name: string) =>
    name in vars ? String(vars[name]) : match,
  );
}

function initialLanguage(): Language {
  const stored = localStorage.getItem(STORAGE_KEY);
  if (stored === 'en' || stored === 'pl') return stored;
  return navigator.language.toLowerCase().startsWith('pl') ? 'pl' : 'en';
}

interface I18n {
  readonly language: Language;
  readonly t: Translate;
  readonly setLanguage: (language: Language) => void;
}

const I18nContext = createContext<I18n | null>(null);

export function I18nProvider({ children }: { children: ReactNode }) {
  const [language, setLanguageState] = useState<Language>(initialLanguage);

  const setLanguage = useCallback((next: Language) => {
    localStorage.setItem(STORAGE_KEY, next);
    document.documentElement.lang = next;
    setLanguageState(next);
  }, []);

  const value = useMemo<I18n>(() => {
    const messages = DICTIONARIES[language];
    return { language, setLanguage, t: (key, vars) => format(messages[key], vars) };
  }, [language, setLanguage]);

  return <I18nContext value={value}>{children}</I18nContext>;
}

export function useI18n(): I18n {
  const context = useContext(I18nContext);
  if (!context) throw new Error('useI18n must be used inside I18nProvider');
  return context;
}
