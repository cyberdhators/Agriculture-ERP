import type { Metadata } from 'next';
import { cookies } from 'next/headers';

import { JoinChooser } from '@/components/auth/JoinChooser';
import { safeNext } from '@/lib/auth/paths';
import { DEFAULT_LANGUAGE, LANG_COOKIE, isLanguage } from '@/lib/i18n';

export const metadata: Metadata = { title: 'Sign in or register' };

export default async function JoinPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const { next } = await searchParams;
  // 2026-10-31 (Arabic pass): the first paint in the language this browser chose.
  const cookieLang = (await cookies()).get(LANG_COOKIE)?.value;
  const initialLanguage = isLanguage(cookieLang) ? cookieLang : DEFAULT_LANGUAGE;
  return <JoinChooser next={safeNext(next)} initialLanguage={initialLanguage} />;
}
