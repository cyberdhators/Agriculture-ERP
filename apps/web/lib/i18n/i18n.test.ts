import { describe, expect, it } from 'vitest';

import { ar } from './ar';
import { en, type TKey } from './en';
import { t } from './index';

/**
 * 2026-10-29 (Arabic for the email side): every English key has its Arabic.
 * `ar` is typed Partial, so the compiler cannot say so; this does. English
 * is still the fallback in `t`, but a key without Arabic is a screen that
 * silently switches language halfway down.
 */

const keys = Object.keys(en) as TKey[];
const placeholders = (text: string) => (text.match(/\{[a-z]+\}/gi) ?? []).sort();

describe('the Arabic dictionary is complete', () => {
  it('reads a dictionary of real size', () => {
    // An empty walk would make every check below pass vacuously.
    expect(keys.length).toBeGreaterThan(1000);
  });

  it('has an Arabic string for every English key', () => {
    const missing = keys.filter((k) => typeof ar[k] !== 'string' || ar[k]!.trim() === '');
    expect(missing, `keys with no Arabic: ${missing.join(', ')}`).toEqual([]);
  });

  it('has no Arabic key the English dictionary does not know', () => {
    const extra = Object.keys(ar).filter((k) => !(k in en));
    expect(extra).toEqual([]);
  });

  it('keeps every placeholder ({n}, {name}, …) in the Arabic', () => {
    const broken = keys.filter(
      (k) => JSON.stringify(placeholders(en[k])) !== JSON.stringify(placeholders(ar[k] ?? '')),
    );
    expect(broken, `placeholders differ: ${broken.join(', ')}`).toEqual([]);
  });

  it('the keys added for the email side are written in Arabic script', () => {
    const prefixes = ['buyer.', 'email.', 'mfa.', 'org.public.', 'pager.'];
    const added = keys.filter((k) => prefixes.some((p) => k.startsWith(p)));
    expect(added.length).toBeGreaterThan(200);
    const latinOnly = added.filter((k) => !/[؀-ۿ]/.test(ar[k] ?? ''));
    expect(latinOnly, `not in Arabic: ${latinOnly.join(', ')}`).toEqual([]);
  });

  it('t() answers in the language asked for, English as the fallback', () => {
    expect(t('email.login.title', 'en')).toBe('Sign in with email');
    expect(t('email.login.title', 'ar')).toBe(ar['email.login.title']);
    expect(t('email.login.title')).toBe('Sign in with email');
  });
});
