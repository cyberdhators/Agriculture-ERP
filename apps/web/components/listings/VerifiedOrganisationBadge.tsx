import { Stamp } from '@/components/ui';
import { t, type Language } from '@/lib/i18n';

/**
 * 2026-10-31 (the owner): ONLY ORGANISATIONS ARE VERIFIED. This replaces the
 * "Verified farmer" badge of 2026-10-19: a person's own account -- a farmer,
 * an individual buyer -- is never verified, so nothing about one shows here.
 * Shown only when CORWADO staff have verified the organisation behind a post
 * or profile, never used to filter, and an unverified organisation shows
 * nothing rather than a "pending" stamp a reader would take as a warning.
 */
export function VerifiedOrganisationBadge({
  verified,
  lang,
}: {
  verified: boolean;
  lang: Language;
}) {
  if (!verified) return null;
  return <Stamp kind="verified">{t('market.verifiedOrganisation', lang)}</Stamp>;
}
