import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { createFarmerSchema, LANGUAGES } from '@agri-erp/shared';

import {
  buildRegistration,
  CONSENT_VERSION,
  draftProblems,
  emptyDraft,
  type RegistrationDraft,
} from './registration';

const MY_PAYAM = 'CE-JUB-MUN';

/**
 * The non-English language, taken from the shared enum rather than written
 * out. The project renamed this value once already (`ar-juba` to `ar`); a test
 * that spells it cannot survive the next rename and would have to be edited by
 * hand, which is the duplication these tests exist to forbid.
 */
const OTHER_LANGUAGE = LANGUAGES.find((language) => language !== 'en')!;
const ID = '9b1f4c62-2d77-4a1e-9a3a-6f2b9c0d1e55';
const newId = () => ID;

/** A complete, valid draft: a farmer in Munuki, consent read in the non-English language. */
const draft = (over: Partial<RegistrationDraft> = {}): RegistrationDraft => ({
  ...emptyDraft(),
  given_name: 'Nyakuoth',
  family_name: 'Gatluak',
  sex: 'f',
  year_of_birth: '1994',
  phone: '+211921000733',
  consent_language: OTHER_LANGUAGE,
  consent_granted: true,
  ...over,
});

describe('the body is built from the session, not from the screen', () => {
  it('takes the payam from the officer’s own scope', () => {
    expect(buildRegistration(draft(), MY_PAYAM, newId).payam_id).toBe(MY_PAYAM);
  });

  it('never sends registered_by — the route stamps the caller, and sending another is 403', () => {
    expect('registered_by' in buildRegistration(draft(), MY_PAYAM, newId)).toBe(false);
  });

  it('never sends a verification status: the schema would refuse it anyway', () => {
    const body = buildRegistration(draft(), MY_PAYAM, newId) as Record<string, unknown>;
    expect('verification_status' in body).toBe(false);
    expect(createFarmerSchema.safeParse({ ...body, verification_status: 'verified' }).success).toBe(
      false,
    );
  });

  it('never sends a caseload owner', () => {
    const body = buildRegistration(draft(), MY_PAYAM, newId) as Record<string, unknown>;
    expect('caseload_officer_id' in body).toBe(false);
  });

  it('carries a client-generated id, which is the idempotency key (C-9.2)', () => {
    expect(buildRegistration(draft(), MY_PAYAM, newId).id).toBe(ID);
  });
});

describe('absent is not null', () => {
  it('an empty national ID leaves the key OUT rather than sending null', () => {
    const body = buildRegistration(draft({ national_id: '' }), MY_PAYAM, newId) as Record<
      string,
      unknown
    >;
    expect('national_id' in body).toBe(false);
  });

  it('a given national ID is sent, trimmed', () => {
    expect(
      buildRegistration(draft({ national_id: ' SSD-8812 ' }), MY_PAYAM, newId).national_id,
    ).toBe('SSD-8812');
  });
});

describe('consent follows the real contract', () => {
  it('offers exactly the languages the shared enum defines', () => {
    expect(Object.keys(CONSENT_VERSION).sort()).toEqual([...LANGUAGES].sort());
  });

  it('sends the text version the chosen language points at', () => {
    const body = buildRegistration(draft({ consent_language: 'en' }), MY_PAYAM, newId);
    expect(body.consent).toEqual({ text_version: 'v1.0-en', language: 'en', granted: true });
  });

  it('is required, because the ROUTE refuses without it even though the schema allows it', () => {
    // 422 consent_required is raised by the handler, not by createFarmerSchema.
    expect(
      createFarmerSchema.safeParse(
        buildRegistration(draft({ consent_language: '' }), MY_PAYAM, newId),
      ).success,
    ).toBe(true);
    const problems = draftProblems(draft({ consent_language: '' }), MY_PAYAM);
    expect(problems.some((p) => p.field === 'consent')).toBe(true);
  });

  it('an ungranted consent is refused before the request is made', () => {
    const problems = draftProblems(draft({ consent_granted: false }), MY_PAYAM);
    expect(problems.some((p) => p.field === 'consent')).toBe(true);
  });

  it('THE VERSION TABLE MATCHES THE ONE IN RegisterFarmer — a seam, gated', () => {
    // That component declares its own copy and does not export it. When the two
    // drift, a farmer's consent record points at a text version that was never
    // shown to them. This fails the moment either side moves.
    const source = readFileSync(
      fileURLToPath(new URL('../../components/farmers/RegisterFarmer.tsx', import.meta.url)),
      'utf8',
    );
    const block = source.slice(
      source.indexOf('CONSENT_VERSION'),
      source.indexOf('};', source.indexOf('CONSENT_VERSION')),
    );
    // Matched WITH ITS QUOTES. A bare substring check passes on a stale map:
    // 'v1.0-ar' is a substring of 'v1.0-ar-juba', so a component left behind by
    // the language rename would satisfy a gate meant to catch exactly that.
    for (const [language, version] of Object.entries(CONSENT_VERSION)) {
      expect(block, `${language} drifted`).toContain(`'${version}'`);
    }
  });
});

describe('the officer is told what is still missing', () => {
  it('a complete draft has no problems', () => {
    expect(draftProblems(draft(), MY_PAYAM)).toEqual([]);
  });

  it('an empty draft reports the required fields by name, in the project’s own wording', () => {
    const problems = draftProblems(emptyDraft(), MY_PAYAM);
    const fields = problems.map((p) => p.field);
    expect(fields).toContain('given_name');
    expect(fields).toContain('family_name');
    expect(fields).toContain('phone');
    expect(problems.every((p) => p.message.length > 0)).toBe(true);
  });

  it('refuses outright when the session carries no payam, rather than guessing one', () => {
    const problems = draftProblems(draft(), null);
    expect(problems).toHaveLength(1);
    expect(problems[0]!.message).toMatch(/payam is not known/i);
  });

  it('every body it calls valid is accepted by the shared schema', () => {
    expect(createFarmerSchema.safeParse(buildRegistration(draft(), MY_PAYAM, newId)).success).toBe(
      true,
    );
  });
});

/**
 * THE LANGUAGE CONTRACT, AFTER THE ar-juba TO ar RENAME.
 *
 * The rename broke this module once: the consent table named its languages by
 * hand, so renaming the shared enum left a key that no longer existed and a
 * missing one that did. These tests do not check for one spelling. They check
 * that officer registration NAMES NO LANGUAGE AT ALL, which is what makes the
 * next rename a non-event.
 */
describe('the language contract is the shared one, not a local copy', () => {
  const read = (relative: string) =>
    readFileSync(fileURLToPath(new URL(relative, import.meta.url)), 'utf8');

  /** Source with comments removed: prose about a rename is not a rename. */
  const code = (relative: string) =>
    read(relative)
      .replace(/\/\*[\s\S]*?\*\//g, ' ')
      .replace(/\{\/\*[\s\S]*?\*\/\}/g, ' ')
      .replace(/(^|[^:])\/\/.*$/gm, '$1 ');

  const MODEL = code('./registration.ts');
  const SCREEN = code('../../components/officer/OfficerRegisterFarmer.tsx');

  it('accepts every language the shared enum currently defines', () => {
    for (const language of LANGUAGES) {
      const body = buildRegistration(draft({ consent_language: language }), MY_PAYAM, newId);
      expect(createFarmerSchema.safeParse(body).success, `${language} refused`).toBe(true);
      expect(body.consent?.language).toBe(language);
    }
  });

  it('writes no language identifier of its own — neither the old one nor the new', () => {
    // The point is not that 'ar-juba' is absent. It is that NOTHING is spelled
    // out, so there is no copy to fall out of step next time.
    for (const [name, source] of [
      ['model', MODEL],
      ['screen', SCREEN],
    ] as const) {
      for (const literal of ["'ar-juba'", '"ar-juba"', "'ar'", '"ar"']) {
        expect(source, `${name} names a language by hand`).not.toContain(literal);
      }
    }
  });

  it('keeps no private language vocabulary beside the canonical one', () => {
    expect(MODEL).not.toMatch(/const\s+LANGUAGES\s*=/);
    expect(SCREEN).not.toMatch(/const\s+LANGUAGES\s*=/);
    // Display names come from the repository's single map, not a local one.
    expect(SCREEN).toContain('LANGUAGE_LABELS');
    expect(MODEL).not.toContain('CONSENT_LANGUAGE_LABEL');
    expect(SCREEN).not.toContain('CONSENT_LANGUAGE_LABEL');
  });

  it('derives the version table from the shared enum, key for key', () => {
    expect(Object.keys(CONSENT_VERSION).sort()).toEqual([...LANGUAGES].sort());
  });

  it('keeps the repository’s v1.0-<language> convention for every language', () => {
    for (const language of LANGUAGES) {
      expect(CONSENT_VERSION[language]).toBe(`v1.0-${language}`);
    }
  });

  it('still builds the request the route expects, in the non-English language', () => {
    const body = buildRegistration(draft(), MY_PAYAM, newId);
    expect(body.consent).toEqual({
      text_version: `v1.0-${OTHER_LANGUAGE}`,
      language: OTHER_LANGUAGE,
      granted: true,
    });
    expect(body.payam_id).toBe(MY_PAYAM);
    expect('registered_by' in body).toBe(false);
  });
});
