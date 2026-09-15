import type { TKey } from '@/lib/i18n';

export const TRADING_NAME_MAX = 60;

/**
 * A trading name is a farm or stall, not a person (scope, "The marketplace
 * amendment": a listing publishes no personal data). The field is free text,
 * so the one control the scope asks for is here: refuse a name that contains
 * the farmer's own given or family name (three letters or more), because that
 * would publish their name with extra steps. Errors are i18n keys.
 */
export function tradingNameError(
  tradingName: string,
  legalName: { given_name: string; family_name: string } | null,
): TKey | undefined {
  const name = tradingName.trim();
  if (name.length < 2) return 'error.tradingName';
  if (name.length > TRADING_NAME_MAX) return 'error.tradingNameLong';
  if (legalName) {
    const lower = name.toLowerCase();
    for (const part of [legalName.given_name, legalName.family_name]) {
      const p = part.trim().toLowerCase();
      if (p.length >= 3 && lower.includes(p)) return 'error.tradingNameIsYourName';
    }
  }
  return undefined;
}
