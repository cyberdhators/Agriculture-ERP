import type { Metadata } from 'next';
import { cookies } from 'next/headers';

import { LoginForm } from '@/components/auth/LoginForm';
import { safeNext } from '@/lib/auth/paths';
import { DEFAULT_LANGUAGE, LANG_COOKIE, isLanguage } from '@/lib/i18n';

export const metadata: Metadata = { title: 'Sign in' };

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const { next } = await searchParams;
  // 2026-10-29: the first paint in the language this browser chose (cookie).
  const cookieLang = (await cookies()).get(LANG_COOKIE)?.value;
  const initialLanguage = isLanguage(cookieLang) ? cookieLang : DEFAULT_LANGUAGE;
  return <LoginForm next={safeNext(next)} initialLanguage={initialLanguage} />;
}
