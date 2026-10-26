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

  it('the phone-account home has no account tile the shortcut hub already offers', () => {
    const src = read('components/farmer/FarmerOverview.tsx');
    const tiles = src.slice(
      src.indexOf('const ACCOUNT_TILES'),
      src.indexOf('export function FarmerOverview'),
    );
    const hrefs = [...tiles.matchAll(/href:\s*'([^']+)'/g)].map((m) => m[1] ?? '');
    expect(hrefs.length).toBeGreaterThan(3);
    const hub = new Set(Object.values(SHORTCUT_HREF.farmer));
    expect(hrefs.filter((h) => hub.has(h))).toEqual([]);
    expect(duplicates(hrefs)).toEqual([]);
  });

  it('nothing below the weather repeats what the hub above it offers (owner, 2026-11-01)', () => {
    const src = read('components/farmer/FarmerOverview.tsx');
    const tiles = src.slice(
      src.indexOf('const ACCOUNT_TILES'),
      src.indexOf('export function FarmerOverview'),
    );
    // "Buy" above the weather and the Market tab already lead to the market.
    expect(tiles).not.toMatch(/href:\s*'\/market'/);
    // The page header repeats no hub destination ("Sell produce" is the hub's).
    const head = src.slice(src.indexOf('<PageHead'), src.indexOf('<ShortcutHub'));
    for (const href of Object.values(SHORTCUT_HREF.farmer)) {
      expect(head.includes(`href="${href}"`), href).toBe(false);
    }
  });

  it("tiles that are also bottom-bar tabs are hidden at the bottom bar's width", () => {
    const shell = read('components/farmer/AccountShell.tsx');
    const bottom = shell.slice(shell.indexOf('const BOTTOM'), shell.indexOf('function isActive'));
    const bottomHrefs = new Set([...bottom.matchAll(/href:\s*'([^']+)'/g)].map((m) => m[1]));
    const src = read('components/farmer/FarmerOverview.tsx');
    const tiles = src.slice(
      src.indexOf('const ACCOUNT_TILES'),
      src.indexOf('export function FarmerOverview'),
    );
    // Each tile object starts at "href:"; the farmer home itself is not a tile.
    for (const block of tiles.split(/(?=href:\s*')/).slice(1)) {
      const href = /href:\s*'([^']+)'/.exec(block)?.[1] ?? '';
      if (bottomHrefs.has(href)) expect(block, href).toMatch(/inBottomBar:\s*true/);
    }
    expect(read('components/farmer/farmer.module.css')).toMatch(
      /\.acctTileBottomBar\s*\{\s*display:\s*none;/,
    );
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
