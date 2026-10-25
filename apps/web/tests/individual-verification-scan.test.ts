import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

/**
 * ONLY ORGANISATIONS ARE VERIFIED, READ AS TEXT (2026-10-31). The owner:
 * "remove verification from accounts. only organization needs to be verified
 * by admin and superadmin not individual." docs/DECISIONS.md, "Only
 * organisations are verified (2026-10-31)".
 *
 * The screens a person or the public sees must not show a person's
 * verification -- no "Verified farmer" badge, no pending or not-verified
 * stamp, no reading of the farmer's field-record status -- and the public
 * reads must not send it. The extension programme's field record stays on
 * the officers' and staff screens (components/farmers, communications,
 * admin), which this scan does not read.
 */

const web = fileURLToPath(new URL('..', import.meta.url));
const read = (path: string) => readFileSync(join(web, path), 'utf8');

function files(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(join(web, dir))) {
    const path = join(dir, name);
    if (statSync(join(web, path)).isDirectory()) out.push(...files(path));
    else if (/\.tsx?$/.test(name) && !name.endsWith('.test.ts')) out.push(path.replace(/\\/g, '/'));
  }
  return out;
}

/** Screens an individual account holder or a visitor sees. */
const PERSON_FACING_DIRS = [
  'components/farmer',
  'components/buyer',
  'components/listings',
  'components/market',
  'components/market-posts',
  'components/profiles',
  'components/public-profile',
  'components/advice',
  'components/messages',
  'components/account',
  'components/teams',
];
const screens = PERSON_FACING_DIRS.flatMap(files);

describe('person-facing screens show no individual verification', () => {
  it('found the screens at all', () => {
    expect(screens.length).toBeGreaterThan(60);
    expect(screens).toContain('components/farmer/FarmerOverview.tsx');
  });

  it('no screen reads a farmer’s verification status or its stamp helpers', () => {
    const offenders = screens.filter((f) =>
      /verification_status|VERIFICATION_KEY|verificationStamp|isVerifiedFarmer/.test(read(f)),
    );
    expect(offenders, 'these person-facing screens show a person’s verification').toEqual([]);
  });

  it('no "Verified farmer" badge exists anywhere in the web app', () => {
    const all = [...files('components'), ...files('lib'), ...files('app')];
    const offenders = all.filter((f) =>
      /Verified farmer|VerifiedFarmerBadge|market\.verifiedFarmer|farmer_verified\b(?!_v)/.test(
        read(f),
      ),
    );
    expect(offenders).toEqual([]);
  });

  it('the badge that remains is the organisation’s', () => {
    expect(read('lib/i18n/en.ts')).toContain(`'market.verifiedOrganisation': 'Verified organisation'`);
    expect(read('components/listings/VerifiedOrganisationBadge.tsx')).toContain(
      'market.verifiedOrganisation',
    );
  });

  it('the farmer’s own account pages carry no verification KPI or banner', () => {
    for (const f of ['components/farmer/FarmerOverview.tsx', 'components/farmer/FarmerVerification.tsx']) {
      const text = read(f);
      expect(text, f).not.toMatch(/account\.kpiVerification|whatPendingTitle|whatRejectedBody/);
    }
  });
});

describe('public reads send no individual verification', () => {
  it('the public listing reads do not select the farmer’s verification status', () => {
    for (const f of ['app/api/listings/route.ts', 'app/api/listings/[id]/route.ts']) {
      expect(read(f), f).not.toMatch(/f\.verification_status/);
    }
  });

  it('the buyer marketplace does not select it either', () => {
    expect(read('lib/api/buyer-presenters.ts')).not.toMatch(/f\.verification_status/);
  });

  it('a post’s badge is its organisation’s, never the farmer’s', () => {
    const text = read('lib/api/market-posts.ts');
    expect(text).not.toMatch(/f\.verification_status/);
    expect(text).toMatch(/posterVerifiedSql\('br'\)/);
    expect(text).toMatch(/posterVerifiedSql\('sl'\)/);
    expect(text).toMatch(/og\.verification_status = 'verified'/);
  });

  it('a profile’s badge is the buyer organisation’s when it is a business, never a farmer’s', () => {
    for (const f of ['lib/api/public-profile.ts', 'app/api/profiles/[kind]/[id]/route.ts']) {
      const text = read(f);
      expect(text, f).not.toMatch(/verification_status::text FROM f\)/);
      expect(text, f).toMatch(/account_type::text <> 'individual'/);
    }
  });
});

describe('organisation verification is a staff action and a badge only', () => {
  const route = 'app/api/admin/organizations/[id]/verification/route.ts';

  it('asks for organization.verify and is audited', () => {
    const text = read(route);
    expect(text).toMatch(/requirePermission\(auth, ORGANIZATION_VERIFY_PERMISSION\)/);
    expect(text).toMatch(/audited\(prisma/);
    expect(text).toMatch(/writeAudit\(/);
  });

  it('no route outside the admin area reads an organisation’s verification to decide anything', () => {
    const gates = files('app/api')
      .filter((f) => !f.startsWith('app/api/admin/'))
      .filter((f) => /(WHERE|AND)\s+og?\.verification_status\s*(=|<>)/.test(read(f)));
    expect(gates).toEqual([]);
  });
});
