import { cookies } from 'next/headers';
import type { ReactNode } from 'react';

import { MarketShell } from '@/components/market/MarketShell';
import { FarmerSessionProvider } from '@/lib/farmer-session';
import { DEFAULT_LANGUAGE, LANG_COOKIE, isLanguage } from '@/lib/i18n';

/**
 * The help page (2026-10-21) wears the marketplace chrome: public, in the
 * farmer's language, and the farmer's own workspace when one is signed in.
 */
export default async function HelpLayout({ children }: { children: ReactNode }) {
  const store = await cookies();
  const cookieLang = store.get(LANG_COOKIE)?.value;
  const initialLanguage = isLanguage(cookieLang) ? cookieLang : DEFAULT_LANGUAGE;

  return (
    <FarmerSessionProvider initialLanguage={initialLanguage}>
      <div className="shop">
        <MarketShell>{children}</MarketShell>
      </div>
    </FarmerSessionProvider>
  );
}
