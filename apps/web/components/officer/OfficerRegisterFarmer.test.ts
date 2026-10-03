import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

/**
 * The officer registration screen's boundaries, read as source. Comments are
 * stripped first: this file explains at length what it refuses to do, and a
 * test that matched that prose would pass on the explanation instead of on the
 * code.
 */
const web = fileURLToPath(new URL('../..', import.meta.url));
const read = (relative: string) => readFileSync(join(web, relative), 'utf8');
const code = (relative: string) =>
  read(relative)
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, ' ')
    .replace(/(^|[^:])\/\/.*$/gm, '$1 ');

const REG = code('components/officer/OfficerRegisterFarmer.tsx');
const BRANCH = code('components/farmers/RegisterFarmerByRole.tsx');
const PAGE = code('app/(portal)/farmers/new/page.tsx');
const DASH = code('components/officer/OfficerDashboard.tsx');

describe('the officer reaches a form built for their authority', () => {
  it('/farmers/new branches by role rather than serving one form to both', () => {
    expect(PAGE).toContain('RegisterFarmerByRole');
    expect(BRANCH).toMatch(
      /role === 'officer'\s*\?\s*<OfficerRegisterFarmer \/>\s*:\s*<RegisterFarmer \/>/,
    );
  });

  it('the administrator’s form is left exactly as it was', () => {
    // The branch imports it; it does not modify it.
    expect(BRANCH).toContain("from './RegisterFarmer'");
  });

  it('the dashboard’s “Register farmer” still arrives somewhere real', () => {
    expect(DASH).toContain('/farmers/new');
    expect(() => read('app/(portal)/farmers/new/page.tsx')).not.toThrow();
  });

  it('the caseload offers it too, so registering is not a trip via the dashboard', () => {
    expect(code('components/officer/OfficerFarmers.tsx')).toContain('/farmers/new');
  });
});

describe('the payam is the session’s, not the officer’s to choose', () => {
  it('takes it from the caseload scope the API returned', () => {
    expect(REG).toMatch(/me\?\.scope\?\.kind === 'caseload'/);
    expect(REG).toContain('me.scope.payamId');
  });

  it('offers no location cascade, because every branch of it would be refused', () => {
    for (const fixture of ['STATES', 'COUNTIES', 'PAYAMS']) {
      expect(REG).not.toContain(fixture);
    }
    expect(REG).not.toMatch(/payam_id:\s*draft\./);
  });

  it('will not submit at all when the session carries no payam', () => {
    expect(REG).toMatch(/disabled=\{saving \|\| !payamId\}/);
    expect(REG).toMatch(/if \(problems\.length > 0 \|\| !payamId\) return;/);
  });
});

describe('it never claims an authority the route would refuse', () => {
  it('does not send registered_by — the server stamps the caller', () => {
    expect(REG).not.toContain('registered_by');
  });

  it.each([
    'verifyFarmer',
    'rejectFarmer',
    'mergeFarmer',
    'reassign',
    'removeFarmer',
    'patchFarmer',
  ])('never calls %s', (fn) => {
    expect(REG).not.toContain(fn);
  });

  it('sets no verification status: a new registration is pending by the server’s rule', () => {
    expect(REG).not.toMatch(/verification_status:\s*/);
  });
});

describe('the record it posts', () => {
  it('is built by the shared model, not assembled inline in the view', () => {
    expect(REG).toContain('buildRegistration(draft, payamId');
    expect(REG).toMatch(/createFarmer\(/);
  });

  it('carries a client-generated id, so a retry cannot create a second farmer (C-9.2)', () => {
    expect(REG).toContain('crypto.randomUUID()');
  });

  it('does not invent the farmer number the server allocates', () => {
    expect(REG).not.toMatch(/farmer_number:\s*/);
  });
});

describe('what it does with what comes back', () => {
  it('shows the server’s farmer number rather than a generic success message', () => {
    expect(REG).toContain('farmer.farmer_number');
  });

  it('surfaces duplicate warnings without treating them as a refusal', () => {
    expect(REG).toContain('duplicates');
    expect(REG).toMatch(/warnings|result\.duplicates/);
  });

  it('offers no merge when duplicates are found — that decision is a supervisor’s', () => {
    expect(REG).not.toContain('mergeFarmer');
    expect(REG).not.toMatch(/>\s*Merge\s*</);
  });
});

describe('the registration slip is reachable again', () => {
  it('lives on the success screen, where the number is assigned', () => {
    expect(REG).toContain('Registration slip');
    expect(REG).toContain('print-flat');
  });

  it('the screen it used to live on is still imported by nothing', () => {
    // OfficerDesk.tsx was branched away from and never deleted; the slip went
    // with it. This records why the slip was rebuilt here rather than linked.
    const importers = [
      'components/officer/OfficerDashboard.tsx',
      'components/officer/OfficerFarmers.tsx',
    ]
      .map(code)
      .filter((source) => source.includes('OfficerDesk'));
    expect(importers).toEqual([]);
  });

  it('printing is offered, never required — a field phone has no printer', () => {
    expect(REG).toContain('window.print()');
    expect(REG).toContain('no-print');
  });
});

describe('it does not pretend to work offline', () => {
  it.each(['localStorage', 'sessionStorage', 'indexedDB', 'navigator.onLine'])(
    'never reaches for %s',
    (api) => {
      expect(REG).not.toContain(api);
    },
  );

  it('a failed request keeps what was typed rather than clearing the form', () => {
    expect(REG).toMatch(/setFailure\(/);
    expect(REG).not.toMatch(/catch[\s\S]{0,120}setDraft\(emptyDraft/);
  });
});
