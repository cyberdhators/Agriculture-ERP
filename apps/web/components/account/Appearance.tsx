'use client';

import { useEffect, useState } from 'react';

import css from './settings.module.css';

type Theme = 'system' | 'light' | 'dark';

const KEY = 'agri-theme';

const WORDS = {
  en: { label: 'Appearance', system: 'Phone', light: 'Light', dark: 'Dark' },
  ar: { label: 'المظهر', system: 'الهاتف', light: 'فاتح', dark: 'داكن' },
} as const;

function apply(theme: Theme) {
  const root = document.documentElement;
  if (theme === 'system') root.removeAttribute('data-theme');
  else root.setAttribute('data-theme', theme);
}

/**
 * Appearance (2026-10-31, dark mode): follow the phone, or always light, or
 * always dark. Kept on this phone (localStorage), like a reading preference;
 * nothing is sent to the server. app/layout.tsx applies it before the first
 * paint; this row changes it.
 */
export function AppearanceRow({ language }: { language: 'en' | 'ar' }) {
  const w = WORDS[language];
  const [theme, setTheme] = useState<Theme>('system');

  useEffect(() => {
    try {
      const saved = localStorage.getItem(KEY);
      if (saved === 'light' || saved === 'dark') setTheme(saved);
    } catch {
      // Storage blocked: the phone's setting applies.
    }
  }, []);

  function choose(next: Theme) {
    setTheme(next);
    apply(next);
    try {
      if (next === 'system') localStorage.removeItem(KEY);
      else localStorage.setItem(KEY, next);
    } catch {
      // Storage blocked: the choice lasts for this visit.
    }
  }

  return (
    <li className={css.row}>
      <span className={css.rowIcon} aria-hidden>
        <svg
          viewBox="0 0 24 24"
          width="20"
          height="20"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5Z" />
        </svg>
      </span>
      <span className={css.rowText}>
        <span className={css.rowLabel}>{w.label}</span>
      </span>
      <span className={css.segmented} role="group" aria-label={w.label}>
        {(['system', 'light', 'dark'] as const).map((option) => (
          <button
            key={option}
            type="button"
            aria-pressed={theme === option}
            onClick={() => choose(option)}
          >
            {w[option]}
          </button>
        ))}
      </span>
    </li>
  );
}
