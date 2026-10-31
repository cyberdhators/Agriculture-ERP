import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { SHORTCUT_HREF } from '@/lib/account/shortcuts';
import { ALL_ITEMS } from '@/lib/portal/nav';

/**
 * 2026-10-31 (the owner: "in mobile view, there's duplicate icons on the
 * dashboards"). On a phone a menu is read by its icons, so a glyph used for
 * two destinations reads as the same row twice, and two tiles to the same
 * page read as a duplicate. What was found on the live site at 390 px:
 *
 *   - the buyer / organisation menu reused a briefcase for five rows, a bar
 *     chart for three, and the dashboard grid for "Sell produce";
 *   - the staff menu reused the briefcase for seven rows;
 *   - the phone-account home showed "Buy" twice (hub and account tiles, same
 *     cart glyph, same page), "Post produce" beside the hub's "Sell produce"
 *     (same page), and Marketplace / AgriOne AI tiles over the bottom bar's
 *     identical tabs.
 *
 * This reads the menus and the home as text and fails if any of it returns.
 */

const web = fileURLToPath(new URL('..', import.meta.url));
const read = (path: string) => readFileSync(join(web, path), 'utf8');

function duplicates(values: readonly string[]): string[] {
  const seen = new Set<string>();
  const twice = new Set<string>();
  for (const v of values) (seen.has(v) ? twice : seen).add(v);
  return [...twice];
}

describe('one icon per destination', () => {
  it('the staff portal menu gives every destination its own icon', () => {
    // Hash destinations (Extension officers, Exports) are their own rows too.
    expect(duplicates(ALL_ITEMS.map((i) => i.icon))).toEqual([]);
  });

  it('the buyer / organisation menu gives every destination its own icon', () => {
    const src = read('components/buyer/BuyerShell.tsx');
    const nav = src.slice(src.indexOf('const NAV:'), src.indexOf('export function BuyerShell'));
    const icons = [...nav.matchAll(/icon:\s*(Icon\w+)/g)].map((m) => m[1] ?? '');
    expect(icons.length).toBeGreaterThan(10);
    expect(duplicates(icons)).toEqual([]);
  });

  it('the phone-account home repeats neither the hub nor the Account page (owner, 2026-10-31)', () => {
    // Home is the welcome card, the hub's round icons, one strip of numbers
    // and the farmer's own things. The account links (security, language,
    // record) live on Account; the full record on "Your record".
    const src = read('components/farmer/FarmerOverview.tsx');
    expect(src).not.toMatch(/ACCOUNT_TILES|acctTiles/);
    for (const href of [
      '/farmer/account/security',
      '/farmer/account/language',
      '/farmer/account/verification',
      '/farmer/account/settings',
    ]) {
      expect(src.includes(`'${href}'`) || src.includes(`"${href}"`), href).toBe(false);
    }
    // "Buy" in the hub and the Market tab already lead to the market.
    expect(src).not.toMatch(/href="\/market"/);
    // No row of links of its own that leads where a round icon already does
    // (an empty state's one next step is not a row of links).
    const hub = new Set(Object.values(SHORTCUT_HREF.farmer));
    const rows = [...src.matchAll(/<Link\s+href="([^"]+)"\s+className=\{`\$\{css\.row\}/g)].map(
      (m) => m[1] ?? '',
    );
    expect(rows.filter((h) => hub.has(h))).toEqual([]);
  });

  it('the shortcut hub draws a different glyph for every tile', () => {
    const src = read('components/account/ShortcutHub.tsx');
    const glyphs = src.slice(
      src.indexOf('const GLYPH'),
      src.indexOf('export function ShortcutHub'),
    );
    const paths = [...glyphs.matchAll(/d="([^"]+)"/g)].map((m) => m[1] ?? '');
    expect(duplicates(paths)).toEqual([]);
    // Not the farm's house either: "Your farm" sits on the same home.
    const overview = read('components/farmer/FarmerOverview.tsx');
    for (const d of paths) expect(overview.includes(`d="${d}"`), d).toBe(false);
  });
});
