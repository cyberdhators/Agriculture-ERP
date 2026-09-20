import type { Language } from '@agri-erp/shared';

import { ar } from './ar';
import { en, type TKey } from './en';

export type { Language };
export type { TKey };
export const FARMER_LANGUAGES: readonly Language[] = ['en', 'ar'];
export const DEFAULT_LANGUAGE: Language = 'en';

export const LANG_COOKIE = 'farmer_lang';
export const LANG_STORAGE = 'farmer-lang';

const DICTS: Record<Language, Partial<Record<TKey, string>>> = {
  en,
  ar,
};

export function t(key: TKey, lang: Language = DEFAULT_LANGUAGE): string {
  return DICTS[lang]?.[key] ?? en[key];
}

export function isRtl(lang: Language): boolean {
  return lang === 'ar';
}

export function htmlLang(lang: Language): string {
  return lang === 'ar' ? 'ar' : 'en';
}

export function isLanguage(value: unknown): value is Language {
  return value === 'en' || value === 'ar';
}
