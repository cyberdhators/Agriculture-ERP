import { cookies } from 'next/headers';
import type { ReactNode } from 'react';

import { BuyerShell } from '@/components/buyer/BuyerShell';
import { DEFAULT_LANGUAGE, LANG_COOKIE, isLanguage } from '@/lib/i18n';

/**
 * The buyer side (B13), in "The Register" like the staff portal: a buyer is a
 * professional user doing procurement work, not a marketplace shopper. The
 * session is required by the middleware; the role by every route, and by the
 * shell, which sends anyone who is not a buyer back where they belong.
 *
 * 2026-10-29: the language cookie is read here, on the server, so the first
 * paint is already in the buyer's language (as the farmer layout does); the
 * shell then follows the account's preferred_language.
 */
export default async function BuyerAccountLayout({ children }: { children: ReactNode }) {
  const store = await cookies();
  const cookieLang = store.get(LANG_COOKIE)?.value;
  const initialLanguage = isLanguage(cookieLang) ? cookieLang : DEFAULT_LANGUAGE;
  return <BuyerShell initialLanguage={initialLanguage}>{children}</BuyerShell>;
}
