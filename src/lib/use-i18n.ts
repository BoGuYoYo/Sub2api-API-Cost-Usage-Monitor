import { useSyncExternalStore } from "react";
import {
  getLocale,
  setLocale,
  subscribeToLocale,
  t,
  type Locale,
  type MessageKey,
} from "./i18n";

export interface I18n {
  locale: Locale;
  t: (key: MessageKey, params?: Record<string, string | number>) => string;
  setLocale: (locale: Locale) => void;
}

/**
 * Subscribe a component to the current language. Every component that renders
 * text uses this, so switching the language re-renders the whole UI at once.
 */
export function useI18n(): I18n {
  const locale = useSyncExternalStore(subscribeToLocale, getLocale, getLocale);
  return { locale, t, setLocale };
}
