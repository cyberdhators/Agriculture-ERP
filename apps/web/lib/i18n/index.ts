import type { Language } from '@agri-erp/shared';

import { arJuba } from './ar-juba';
import { en, type TKey } from './en';

/**
 * The farmer flow's tiny translation layer. `t(key, lang)` returns the
 * Arabi-Juba string when CORWADO has supplied one and English otherwise, so a
 * half-translated interface is coherent rather than broken. The language is
 * chosen on `/farmer`, kept in localStorage and a cookie, and read by the
 * farmer layout — never inferred, never machine-translated.
 */

export type { Language };
export type { TKey };
export const FARMER_LANGUAGES: readonly Language[] = ['en', 'ar-juba'];
export const DEFAULT_LANGUAGE: Language = 'en';

/** The cookie the farmer layout reads to render on the server without a flash. */
export const LANG_COOKIE = 'farmer_lang';
/** The localStorage key the picker writes so the choice survives a return visit. */
export const LANG_STORAGE = 'farmer-lang';

const DICTS: Record<Language, Partial<Record<TKey, string>>> = {
  en,
  'ar-juba': arJuba,
};

export function t(key: TKey, lang: Language = DEFAULT_LANGUAGE): string {
  return DICTS[lang]?.[key] ?? en[key];
}

/** Arabi Juba is written right to left; the layout mirrors for it and only it. */
export function isRtl(lang: Language): boolean {
  return lang === 'ar-juba';
}

/** The `lang` attribute the document carries for a chosen interface language. */
export function htmlLang(lang: Language): string {
  return lang === 'ar-juba' ? 'ar' : 'en';
}

export function isLanguage(value: unknown): value is Language {
  return value === 'en' || value === 'ar-juba';
}
