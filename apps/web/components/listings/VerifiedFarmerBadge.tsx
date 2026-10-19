import { Stamp } from '@/components/ui';
import { t, type Language } from '@/lib/i18n';

/**
 * LISTINGS LANE (2026-10-19). The owner dropped #127: a farmer no longer needs
 * staff verification for their listings to go live. Verification is shown as
 * this badge -- only when it is true, and never used to filter. An unverified
 * farmer shows nothing, rather than a "pending" stamp a buyer would read as a
 * warning.
 */
export function VerifiedFarmerBadge({ verified, lang }: { verified: boolean; lang: Language }) {
  if (!verified) return null;
  return <Stamp kind="verified">{t('market.verifiedFarmer', lang)}</Stamp>;
}
