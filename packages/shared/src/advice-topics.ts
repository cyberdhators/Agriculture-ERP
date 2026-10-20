/**
 * ADVICE TOPICS (2026-10-22). One list for advice providers, advice requests
 * and Advice & Learning content, so a farmer filters all three the same way.
 */
export const ADVICE_TOPICS = [
  'crops',
  'livestock',
  'soil_fertiliser',
  'pests_diseases',
  'water_irrigation',
  'post_harvest',
  'marketing_prices',
  'finance_business',
  'climate_weather',
  'other',
] as const;
export type AdviceTopic = (typeof ADVICE_TOPICS)[number];
