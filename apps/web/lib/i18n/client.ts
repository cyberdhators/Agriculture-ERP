'use client';

import { useCallback, useEffect, useState } from 'react';

import { useArabicEnabled } from '@/lib/settings/client';

import { LANG_COOKIE, LANG_STORAGE, htmlLang, isLanguage, isRtl, type Language } from './index';

/**
 * 2026-10-29 (Arabic for the email side): the same language choice the farmer
 * session keeps -- a cookie for the server's first paint and local storage --
 * for the screens outside the farmer session: email sign-in and sign-up, the
 * buyer shell and the public organisation page. One choice per browser, so a
 * person who picks Arabic on one side reads Arabic on the other.
 */

function readCookie(name: string): string | null {
  if (typeof document === 'undefined') return null;
  const match = document.cookie.match(new RegExp(`(?:^|; )${name}=([^;]*)`));
  return match ? decodeURIComponent(match[1]!) : null;
}

/** The language this browser chose last, if any. */
export function storedLanguage(): Language | null {
  let stored: string | null = null;
  try {
    stored = window.localStorage.getItem(LANG_STORAGE);
  } catch {
    // Private window: the cookie still carries the choice.
  }
  return [stored, readCookie(LANG_COOKIE)].find(isLanguage) ?? null;
}

/** Keep the choice in the cookie (server render) and local storage. */
export function rememberLanguage(lang: Language): void {
  if (typeof document === 'undefined') return;
  document.cookie = `${LANG_COOKIE}=${encodeURIComponent(lang)}; path=/; max-age=31536000; samesite=lax`;
  try {
    window.localStorage.setItem(LANG_STORAGE, lang);
  } catch {
    // Private window: the cookie still carries the choice.
  }
}

/**
 * The page's language: the server's guess from the cookie first, then this
 * browser's stored choice. English whenever Settings switch Arabic off.
 */
export function useLanguageChoice(initial: Language): [Language, (lang: Language) => void] {
  const [language, setLanguageState] = useState<Language>(initial);
  useEffect(() => {
    const stored = storedLanguage();
    if (stored) setLanguageState(stored);
  }, []);
  const arabic = useArabicEnabled();
  const setLanguage = useCallback((lang: Language) => {
    setLanguageState(lang);
    rememberLanguage(lang);
  }, []);
  return [arabic ? language : 'en', setLanguage];
}

/**
 * Puts `<html>` in the page's language and direction while the page is shown,
 * and restores it on the way out (as the farmer shell does), so the staff
 * portal is never left in RTL.
 */
export function useDocumentLanguage(language: Language): void {
  useEffect(() => {
    const root = document.documentElement;
    const prevLang = root.lang;
    const prevDir = root.getAttribute('dir');
    root.lang = htmlLang(language);
    root.dir = isRtl(language) ? 'rtl' : 'ltr';
    return () => {
      root.lang = prevLang || 'en';
      if (prevDir) root.setAttribute('dir', prevDir);
      else root.removeAttribute('dir');
    };
  }, [language]);
}
