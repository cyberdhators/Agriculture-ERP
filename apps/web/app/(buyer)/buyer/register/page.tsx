import type { Metadata } from 'next';
import { cookies } from 'next/headers';

import { BuyerRegister } from '@/components/buyer/BuyerRegister';
import { DEFAULT_LANGUAGE, LANG_COOKIE, isLanguage } from '@/lib/i18n';

export const metadata: Metadata = { title: 'Create an account' };

/** Outside the buyer shell and outside the session gate: the applicant has no account yet. */
export default async function BuyerRegisterPage() {
  // 2026-10-29: the first paint in the language this browser chose (cookie).
  const cookieLang = (await cookies()).get(LANG_COOKIE)?.value;
  const initialLanguage = isLanguage(cookieLang) ? cookieLang : DEFAULT_LANGUAGE;
  // 2026-10-31: the member look (`.shop`), like every other sign-up page; it
  // sits outside the buyer shell, so it carries the class itself.
  return (
    <div className="shop">
      <BuyerRegister initialLanguage={initialLanguage} />
    </div>
  );
}
