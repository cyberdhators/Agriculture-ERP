import { cookies } from 'next/headers';
import type { ReactNode } from 'react';

import { MarketModerationProvider } from '@/components/market/moderation';
import { MarketShell } from '@/components/market/MarketShell';
import { FarmerSessionProvider } from '@/lib/farmer-session';
import { DEFAULT_LANGUAGE, LANG_COOKIE, isLanguage } from '@/lib/i18n';
import { PreviewProvider } from '@/lib/preview';

/**
 * The marketplace is one route for both audiences. A signed-in farmer gets
 * the farmer workspace chrome in their language; otherwise the staff portal
 * shell carries it, scoped by role.
 */
export default async function MarketLayout({ children }: { children: ReactNode }) {
  const store = await cookies();
  const cookieLang = store.get(LANG_COOKIE)?.value;
  const initialLanguage = isLanguage(cookieLang) ? cookieLang : DEFAULT_LANGUAGE;

  return (
    <FarmerSessionProvider initialLanguage={initialLanguage}>
      <PreviewProvider>
        <MarketModerationProvider>
          <div className="shop">
            <MarketShell>{children}</MarketShell>
          </div>
        </MarketModerationProvider>
      </PreviewProvider>
    </FarmerSessionProvider>
  );
}
