import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

/**
 * 2026-10-29 (Arabic for the email side): the email sign-in and sign-up, the
 * buyer's home, profile, settings and notifications, and the public
 * organisation page speak English or Arabic through lib/i18n. This reads the
 * components as text and fails when user-facing English is typed straight
 * into them again -- the way these screens came to be English-only.
 *
 * What counts as user-facing English: a JSX text line, a string given to a
 * user-facing attribute (label, title, hint, aria-label, …), and a sentence
 * handed to an error, failure or toast. Comments are removed first.
 */

const web = fileURLToPath(new URL('..', import.meta.url));
const read = (path: string) => readFileSync(join(web, path), 'utf8');

const SCREENS = [
  'components/auth/LoginForm.tsx',
  'components/auth/MfaCodeStep.tsx',
  'components/buyer/BuyerRegister.tsx',
  'components/buyer/ProcurementFields.tsx',
  'components/buyer/BuyerShell.tsx',
  'components/buyer/BuyerDashboard.tsx',
  'components/buyer/BuyerNotifications.tsx',
  'components/buyer/BuyerProfile.tsx',
  'components/buyer/BuyerPages.tsx',
  'components/teams/PublicOrganisation.tsx',
  'components/account/BlockedAccounts.tsx',
  'components/account/NotificationSettings.tsx',
];

/**
 * The staff sign-in shares LoginForm and stays English (the staff portal is
 * not translated). These are its sentences, and only these.
 */
const STAFF_ONLY: Record<string, readonly string[]> = {
  'components/auth/LoginForm.tsx': [
    'For CORWADO staff and extension officers. Staff sign in with their email address;',
    'extension officers with their phone number. Accounts are issued by an administrator.',
    'Forgot your password? Staff: <a href="/forgot-password">reset it by email</a>. Extension',
    'officers: ask an administrator.',
    'Not staff? <a href="/join">Sign in or create an account</a> to buy, sell and get advice.',
    'Not staff?',
    'Sign in or create an account',
  ],
};

const stripComments = (text: string) =>
  text
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '')
    .replace(/\s\/\/ .*$/gm, '');

const ATTRIBUTES =
  /\b(label|title|subtitle|hint|aria-label|placeholder|body|empty|note|intro|eyebrow|unmeasuredBecause)="([A-Z][^"]*[a-z][^"]*)"/g;
const SENTENCE_CALLS =
  /\b(setError|setFailure|setCodeError|setCodeNote|setMessage|setFailed)\(\s*'([^']*[A-Za-z]{2,}[^']*)'/g;
const TOAST_TITLE = /\btitle:\s*'([^']*[A-Za-z]{2,}[^']*)'/g;
/** A line that is nothing but words: JSX text, as prettier lays it out. */
const TEXT_LINE = /^\s*([A-Z][A-Za-z’'",.;:?!()\-]* [A-Za-z’'",.;:?!()<>="/\- ]*[a-z][A-Za-z’'",.;:?!()<>="/\- ]*)$/;
const INLINE_TEXT = /(?<![=-])>\s*([A-Z][a-z][A-Za-z ,.'’?!-]*)\s*</g;

function englishIn(path: string): string[] {
  const allowed = new Set(STAFF_ONLY[path] ?? []);
  const text = stripComments(read(path));
  const found: string[] = [];
  for (const m of text.matchAll(ATTRIBUTES)) found.push(`${m[1]}="${m[2]}"`);
  for (const m of text.matchAll(SENTENCE_CALLS)) found.push(`${m[1]}('${m[2]}')`);
  for (const m of text.matchAll(TOAST_TITLE)) found.push(`title: '${m[1]}'`);
  for (const m of text.matchAll(INLINE_TEXT)) {
    if (!allowed.has(m[1]!.trim())) found.push(`>${m[1]}<`);
  }
  for (const line of text.split('\n')) {
    const m = line.match(TEXT_LINE);
    if (m && !allowed.has(m[1]!.trim())) found.push(m[1]!.trim());
  }
  return found;
}

describe('the email side has no hard-coded English left', () => {
  it.each(SCREENS)('%s', (path) => {
    expect(englishIn(path)).toEqual([]);
  });

  it('the scan does catch English when it is there', () => {
    // A guard on the guard: each pattern finds the kind of string it is for.
    const probe = [
      '<Field label="First name">',
      "setFailure('The profile could not be saved.')",
      '          Send the code again',
    ].join('\n');
    expect(probe.match(ATTRIBUTES)).not.toBeNull();
    expect(probe.match(SENTENCE_CALLS)).not.toBeNull();
    expect(probe.split('\n').some((l) => TEXT_LINE.test(l))).toBe(true);
  });

  it('the staff sign-in keeps its English, and only it', () => {
    const text = read('components/auth/LoginForm.tsx');
    expect(text).toMatch(/staff \? 'Staff sign in' : w\('email\.login\.title'\)/);
    expect(text).toMatch(/const language: Language = staff \? 'en' : chosen;/);
  });
});

describe('the email side follows the chosen language and turns right-to-left', () => {
  it.each([
    'components/auth/LoginForm.tsx',
    'components/buyer/BuyerRegister.tsx',
    'components/buyer/BuyerShell.tsx',
    'components/teams/PublicOrganisation.tsx',
  ])('%s sets the document language and direction', (path) => {
    const text = read(path);
    expect(text).toMatch(/useDocumentLanguage\(language\)/);
    expect(text).toMatch(/dir=\{(rtl|isRtl\(language\)) \? 'rtl' : 'ltr'\}/);
  });

  it('the server reads the language cookie for the first paint', () => {
    for (const page of [
      'app/(auth)/login/page.tsx',
      'app/(buyer)/buyer/register/page.tsx',
      'app/(buyer)/buyer/(account)/layout.tsx',
      'app/organisations/[id]/page.tsx',
    ]) {
      expect(read(page), page).toMatch(/get\(LANG_COOKIE\)/);
    }
  });

  it('the buyer shell adopts the account preferred_language and saves the switch', () => {
    const text = read('components/buyer/BuyerShell.tsx');
    expect(text).toMatch(/loaded\.person\.preferred_language/);
    expect(text).toMatch(/updateProfile\(\{ preferred_language: lang \}\)/);
    const route = read('app/api/buyer/profile/route.ts');
    expect(route).toMatch(/b\.preferred_language::text AS preferred_language/);
    expect(route).toMatch(/'::public\.language'/);
  });

  it('no buyer page is pinned to English any more', () => {
    const root = join(web, 'app/(buyer)/buyer/(account)');
    const pinned: string[] = [];
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        const full = join(dir, name);
        if (statSync(full).isDirectory()) walk(full);
        else if (/\.tsx$/.test(name) && /\b(lang|language)="en"/.test(readFileSync(full, 'utf8')))
          pinned.push(full);
      }
    };
    walk(root);
    for (const shared of [
      'components/buyer/BuyerDashboard.tsx',
      'components/buyer/BuyerProfile.tsx',
      'components/buyer/BuyerShell.tsx',
      'components/market-posts/Pages.tsx',
      'components/public-profile/Pages.tsx',
    ]) {
      const text = read(shared);
      const buyerPart = shared.endsWith('market-posts/Pages.tsx')
        ? text.slice(text.indexOf('export function BuyerBuyingRequestsPage'))
        : text;
      if (
        /\b(lang|language)="en"|, 'en'\)/.test(
          buyerPart.replace(/t\('language\.(name|arabicNative)', 'en'\)/g, ''),
        )
      )
        pinned.push(shared);
    }
    expect(pinned).toEqual([]);
  });
});
