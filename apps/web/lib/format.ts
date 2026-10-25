import type {
  AdviceTopic,
  DateFormat,
  Crop,
  DirectoryEntryType,
  FinancialProviderClass,
  Language,
  LearningStatus,
  LearningTopic,
  ResourceFormat,
} from '@agri-erp/shared';

/**
 * Display helpers. Labels for every enum the portal shows, and the few
 * formatting rules the design document fixes: dates are "27 Jul 2026", sizes
 * are human readable, phone numbers are grouped for reading aloud.
 */

export const ENTRY_TYPE_LABELS: Record<DirectoryEntryType, string> = {
  agro_dealer: 'Agro-dealer',
  input_supplier: 'Input supplier',
  financial_service: 'Financial service',
};

export const ENTRY_TYPE_PLURAL: Record<DirectoryEntryType, string> = {
  agro_dealer: 'Agro-dealers',
  input_supplier: 'Input suppliers',
  financial_service: 'Financial services',
};

export const PROVIDER_CLASS_LABELS: Record<FinancialProviderClass, string> = {
  bank: 'Bank',
  microfinance: 'Microfinance',
  mobile_money: 'Mobile money',
  cooperative_sacco: 'Cooperative / SACCO',
  other: 'Other',
};

export const TOPIC_LABELS: Record<LearningTopic, string> = {
  crop_production: 'Crop production',
  livestock: 'Livestock',
  pest_disease: 'Pests and disease',
  post_harvest: 'Post-harvest',
  marketing: 'Marketing',
  cooperative: 'Cooperatives',
  climate: 'Climate',
  other: 'Other',
};

/** 2026-10-22: the shared advice topics, as staff read them. Farmers read lib/i18n. */
export const ADVICE_TOPIC_LABELS: Record<AdviceTopic, string> = {
  crops: 'Crops',
  livestock: 'Livestock',
  soil_fertiliser: 'Soil and fertiliser',
  pests_diseases: 'Pests and diseases',
  water_irrigation: 'Water and irrigation',
  post_harvest: 'Post-harvest',
  marketing_prices: 'Marketing and prices',
  finance_business: 'Finance and business',
  climate_weather: 'Climate and weather',
  other: 'Other',
};

/** 2026-10-22: Advice & Learning's workflow states. */
export const LEARNING_STATUS_LABELS: Record<LearningStatus, string> = {
  draft: 'Draft',
  in_review: 'In review',
  published: 'Published',
  unpublished: 'Unpublished',
};

export const CROP_LABELS: Record<Crop, string> = {
  sorghum: 'Sorghum',
  groundnut: 'Groundnut',
  sesame: 'Sesame',
  maize: 'Maize',
  cowpea: 'Cowpea',
};

export const LANGUAGE_LABELS: Record<Language, string> = {
  en: 'English',
  ar: 'العربية',
};

export const FORMAT_LABELS: Record<ResourceFormat, string> = {
  pdf: 'PDF',
  image: 'Image',
  audio: 'Audio',
  video: 'Video',
};

const DATE_OPTS: Intl.DateTimeFormatOptions = {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
  timeZone: 'UTC',
};
const DATE_FORMATTERS = new Map<Language, Intl.DateTimeFormat>();
function dateFormatter(language: Language): Intl.DateTimeFormat {
  let f = DATE_FORMATTERS.get(language);
  if (!f) {
    f = new Intl.DateTimeFormat(language === 'ar' ? 'ar' : 'en-GB', DATE_OPTS);
    DATE_FORMATTERS.set(language, f);
  }
  return f;
}

/**
 * 2026-10-27 (settings phase 2): the date format chosen in Settings ->
 * Language and region. Set once the public settings arrive (the site banner
 * reads them on every page); until then, and on any failure, "27 Jul 2026".
 */
let displayDateFormat: DateFormat = 'd_mmm_yyyy';

export function setDisplayDateFormat(format: DateFormat): void {
  displayDateFormat = format;
}

const NUMERIC_FORMATTERS = new Map<Language, Intl.DateTimeFormat>();
function numericFormatter(language: Language): Intl.DateTimeFormat {
  let f = NUMERIC_FORMATTERS.get(language);
  if (!f) {
    f = new Intl.DateTimeFormat(language === 'ar' ? 'ar' : 'en-GB', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      timeZone: 'UTC',
    });
    NUMERIC_FORMATTERS.set(language, f);
  }
  return f;
}

/** "2026-07-27" or an ISO timestamp -> "27 Jul 2026" (or the format Settings chose). */
export function formatDate(iso: string, language: Language = 'en'): string {
  const date = new Date(iso.length === 10 ? `${iso}T00:00:00Z` : iso);
  if (Number.isNaN(date.getTime())) return iso;
  if (displayDateFormat === 'yyyy_mm_dd') return date.toISOString().slice(0, 10);
  if (displayDateFormat === 'dd_mm_yyyy') return numericFormatter(language).format(date);
  return dateFormatter(language).format(date);
}

/** Whole days from a YYYY-MM-DD date to now, never negative. */
export function daysSince(isoDate: string, now: Date = new Date()): number {
  const then = new Date(`${isoDate}T00:00:00Z`).getTime();
  const diff = Math.floor((now.getTime() - then) / 86_400_000);
  return diff < 0 ? 0 : diff;
}

/**
 * An entry not checked for six months is stale (C-13.4). The portal shows
 * that plainly rather than hiding the entry: a farmer sent to a closed shop
 * is worse than a farmer told "we last checked in March".
 */
export const STALE_AFTER_DAYS = 180;

export function isStale(lastVerifiedAt: string, now?: Date): boolean {
  return daysSince(lastVerifiedAt, now) > STALE_AFTER_DAYS;
}

/** Bytes -> "41.2 MB". One decimal above KB, none for bytes. */
export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return '—';
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KB', 'MB', 'GB'];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value.toFixed(value >= 100 ? 0 : 1)} ${units[unit]}`;
}

/** "+211928841107" -> "+211 92 884 1107", the grouping used on the designs. */
export function formatPhone(e164: string): string {
  const match = /^\+211(\d{2})(\d{3})(\d{4})$/.exec(e164);
  if (!match) return e164;
  return `+211 ${match[1]} ${match[2]} ${match[3]}`;
}

/** Two-letter monogram for an avatar tile, "Juba Agro Supplies" -> "JA". */
export function monogram(name: string): string {
  const words = name
    .replace(/\(.*?\)/g, '')
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  const first = words[0]?.[0] ?? '';
  const second = words[1]?.[0] ?? words[0]?.[1] ?? '';
  return (first + second).toUpperCase();
}

export function pluralise(count: number, singular: string, plural = `${singular}s`): string {
  return `${count} ${count === 1 ? singular : plural}`;
}
