import { cookies } from 'next/headers';
import type { ReactNode } from 'react';

import { FarmerShell } from '@/components/farmer/FarmerShell';
import { FarmerSessionProvider } from '@/lib/farmer-session';
import { DEFAULT_LANGUAGE, LANG_COOKIE, isLanguage } from '@/lib/i18n';

/**
 * The farmer flow's own layout — a separate route group from the staff portal
 * so it carries neither the masthead nor the role switcher. The chosen language
 * is read from its cookie here, on the server, so the first paint is already in
 * the farmer's language; the shell then keeps `<html>` in step for RTL.
 */
export default async function FarmerLayout({ children }: { children: ReactNode }) {
  const store = await cookies();
  const cookieLang = store.get(LANG_COOKIE)?.value;
  const initialLanguage = isLanguage(cookieLang) ? cookieLang : DEFAULT_LANGUAGE;

  return (
    <FarmerSessionProvider initialLanguage={initialLanguage}>
      <FarmerShell>{children}</FarmerShell>
    </FarmerSessionProvider>
  );
}
