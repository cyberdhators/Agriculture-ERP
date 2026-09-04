'use client';

import type { ReactNode } from 'react';

import { AccountShell } from '@/components/farmer/AccountShell';
import { FarmerShell } from '@/components/farmer/FarmerShell';
import { ShopMasthead } from '@/components/farmer/ShopMasthead';
import { Wordmark } from '@/components/brand/Wordmark';
import { useFarmerSession } from '@/lib/farmer-session';
import { t } from '@/lib/i18n';

import farmer from '@/components/farmer/farmer.module.css';

/**
 * The marketplace chrome. A signed-in farmer gets the full account workspace
 * (its own Amazon masthead with the account tabs); everyone else gets the
 * lighter marketplace chrome — the same Amazon masthead with the category
 * strip — so the browse and product pages read as a shopping site for visitors
 * and staff alike, without touching the staff portal shell.
 */
export function MarketShell({ children }: { children: ReactNode }) {
  const { farmer: signedIn, language } = useFarmerSession();
  if (signedIn) {
    return (
      <FarmerShell>
        <AccountShell>{children}</AccountShell>
      </FarmerShell>
    );
  }
  return (
    <div className={farmer.account}>
      <a href="#farmer-main" className="skip-link">
        {t('shell.skip', language)}
      </a>
      <ShopMasthead />
      <main id="farmer-main" className={farmer.main} tabIndex={-1}>
        {children}
      </main>
      <footer className={farmer.footer}>
        <div className={farmer.footerInner}>
          <Wordmark size={18} tagline taglineText={t('brand.tagline', language)} />
          <span>{t('brand.copyright', language)}</span>
        </div>
      </footer>
    </div>
  );
}
