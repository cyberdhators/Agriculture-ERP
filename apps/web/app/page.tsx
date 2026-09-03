import type { Metadata } from 'next';
import { cookies } from 'next/headers';

import { EntrySpread } from '@/components/farmer/EntrySpread';
import { FarmerLogin } from '@/components/farmer/FarmerLogin';
import { FarmerShell } from '@/components/farmer/FarmerShell';
import { FarmerSessionProvider } from '@/lib/farmer-session';
import { DEFAULT_LANGUAGE, LANG_COOKIE, isLanguage } from '@/lib/i18n';

export const metadata: Metadata = { title: { absolute: 'AgriOne' } };

/**
 * The public entry: the AgriOne spread with sign-in, registration, the staff
 * link and the language switch. Composed the same way as the farmer route
 * group so the first paint is already in the chosen language.
 */
export default async function Home() {
  const store = await cookies();
  const cookieLang = store.get(LANG_COOKIE)?.value;
  const initialLanguage = isLanguage(cookieLang) ? cookieLang : DEFAULT_LANGUAGE;

  return (
    <FarmerSessionProvider initialLanguage={initialLanguage}>
      <FarmerShell>
        <EntrySpread>
          <FarmerLogin />
        </EntrySpread>
      </FarmerShell>
    </FarmerSessionProvider>
  );
}
