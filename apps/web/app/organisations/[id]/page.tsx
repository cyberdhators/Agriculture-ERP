import type { Metadata } from 'next';
import { cookies } from 'next/headers';

import { PublicOrganisation } from '@/components/teams/PublicOrganisation';
import { DEFAULT_LANGUAGE, LANG_COOKIE, isLanguage } from '@/lib/i18n';

export const metadata: Metadata = { title: 'Organisation' };

/** 2026-10-27 (team access): an organisation's public profile, when published. */
export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  // 2026-10-29: the first paint in the language this browser chose (cookie).
  const cookieLang = (await cookies()).get(LANG_COOKIE)?.value;
  const initialLanguage = isLanguage(cookieLang) ? cookieLang : DEFAULT_LANGUAGE;
  // 2026-10-31: the member look (`.shop`), as on every other public page.
  return (
    <div className="shop">
      <PublicOrganisation id={id} initialLanguage={initialLanguage} />
    </div>
  );
}
