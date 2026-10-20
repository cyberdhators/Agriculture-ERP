import {
  ADVICE_TOPICS,
  type AdviceCaseStatus,
  type AdviceContactMode,
  type AdviceDeliveryMode,
  type AdviceLanguage,
  type AdviceOutcome,
  type AdviceProviderKind,
  type AdviceProviderStatus,
  type AdviceTerms,
  type AdviceTopic,
} from '@agri-erp/shared';

import { t, type Language, type TKey } from '@/lib/i18n';

/** INDEPENDENT ADVICE (2026-10-22): each stored word, as a person reads it. */

export const TOPIC_KEY: Record<AdviceTopic, TKey> = {
  crops: 'advice.topic.crops',
  livestock: 'advice.topic.livestock',
  soil_fertiliser: 'advice.topic.soil_fertiliser',
  pests_diseases: 'advice.topic.pests_diseases',
  water_irrigation: 'advice.topic.water_irrigation',
  post_harvest: 'advice.topic.post_harvest',
  marketing_prices: 'advice.topic.marketing_prices',
  finance_business: 'advice.topic.finance_business',
  climate_weather: 'advice.topic.climate_weather',
  other: 'advice.topic.other',
};

export const KIND_KEY: Record<AdviceProviderKind, TKey> = {
  independent_adviser: 'advice.kind.independent_adviser',
  institute: 'advice.kind.institute',
  research_training: 'advice.kind.research_training',
  advisory_organization: 'advice.kind.advisory_organization',
  other: 'advice.kind.other',
};

export const LANGUAGE_KEY: Record<AdviceLanguage, TKey> = {
  en: 'advice.lang.en',
  ar: 'advice.lang.ar',
  juba_arabic: 'advice.lang.juba_arabic',
  dinka: 'advice.lang.dinka',
  nuer: 'advice.lang.nuer',
  bari: 'advice.lang.bari',
  other: 'advice.lang.other',
};

export const MODE_KEY: Record<AdviceDeliveryMode, TKey> = {
  remote: 'advice.mode.remote',
  in_person: 'advice.mode.in_person',
};

export const TERMS_KEY: Record<AdviceTerms, TKey> = {
  free: 'advice.termsOf.free',
  paid: 'advice.termsOf.paid',
  free_and_paid: 'advice.termsOf.free_and_paid',
};

export const CONTACT_KEY: Record<AdviceContactMode, TKey> = {
  in_app: 'advice.contact.in_app',
  phone: 'advice.contact.phone',
  sms: 'advice.contact.sms',
};

export const STATUS_KEY: Record<AdviceCaseStatus, TKey> = {
  open: 'advice.status.open',
  in_progress: 'advice.status.in_progress',
  closed: 'advice.status.closed',
};

export const OUTCOME_KEY: Record<AdviceOutcome, TKey> = {
  resolved: 'advice.outcome.resolved',
  referred: 'advice.outcome.referred',
  closed_unresolved: 'advice.outcome.closed_unresolved',
  cancelled: 'advice.outcome.cancelled',
};

export const PROVIDER_STATUS_KEY: Record<AdviceProviderStatus, TKey> = {
  draft: 'advice.pstatus.draft',
  published: 'advice.pstatus.published',
  unpublished: 'advice.pstatus.unpublished',
};

/** A topic key as a word; anything else (an older title) as it is. */
export function topicLabel(topic: string, lang: Language): string {
  return (ADVICE_TOPICS as readonly string[]).includes(topic)
    ? t(TOPIC_KEY[topic as AdviceTopic], lang)
    : topic;
}

/** Where a case's page is, on the side of the app the person is in. */
export const caseHref = (side: 'farmer' | 'buyer', id: string) =>
  side === 'buyer' ? `/buyer/advice/cases/${id}` : `/farmer/account/advice/cases/${id}`;

/** Where the advice pages are, on each side of the app. */
export const FARMER_ADVICE = {
  find: '/advice',
  requests: '/farmer/account/advice/requests',
  offer: '/farmer/account/advice/offer',
  work: '/farmer/account/advice/work',
} as const;

export const BUYER_ADVICE = {
  find: '/buyer/advice',
  requests: '/buyer/advice/requests',
  offer: '/buyer/advice/offer',
  work: '/buyer/advice/work',
} as const;
