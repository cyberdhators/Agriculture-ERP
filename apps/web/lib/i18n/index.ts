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

/** The keys that have plural forms: `<base>.zero|one|two|few|many|other`. */
export type PluralBase = {
  [K in TKey]: K extends `${infer B}.other` ? B : never;
}[TKey];

/**
 * 2026-10-27: a count with its noun in the right plural form ("1 rating",
 * "2 ratings"; Arabic's six forms), chosen by Intl.PluralRules for the
 * language. A form a dictionary lacks falls back to its `other`, then to
 * English. `{n}` is replaced by the count.
 */
export function tCount(base: PluralBase, count: number, lang: Language = DEFAULT_LANGUAGE): string {
  const form = new Intl.PluralRules(lang === 'ar' ? 'ar' : 'en').select(count);
  const dict = (DICTS[lang] ?? en) as Partial<Record<string, string>>;
  const english = en as Record<string, string>;
  const text =
    dict[`${base}.${form}`] ??
    dict[`${base}.other`] ??
    english[`${base}.${form}`] ??
    english[`${base}.other`] ??
    '{n}';
  return text.replace('{n}', String(count));
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
