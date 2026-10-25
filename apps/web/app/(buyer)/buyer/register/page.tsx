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
  return <BuyerRegister initialLanguage={initialLanguage} />;
}
