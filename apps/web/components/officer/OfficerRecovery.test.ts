import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { classify } from '@/lib/officer/recovery';

/**
 * How the officer screens USE the recovery model, read as source.
 *
 * The model's own behaviour is proved in `lib/officer/recovery.test.ts`. These
 * guard the thing a model cannot: that the screens actually route failures
 * through it instead of printing whatever the server said, and that none of
 * them quietly reintroduces a queue, a redirect or an ownership lookup.
 */
const web = fileURLToPath(new URL('../..', import.meta.url));
const read = (relative: string) => readFileSync(join(web, relative), 'utf8');
const code = (relative: string) =>
  read(relative)
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, ' ')
    .replace(/(^|[^:])\/\/.*$/gm, '$1 ');

const WRITERS = [
  'components/officer/OfficerRegisterFarmer.tsx',
  'components/officer/OfficerFarmerEdit.tsx',
  'components/officer/OfficerRecordVisit.tsx',
  'components/officer/OfficerVisitDetail.tsx',
  'components/officer/OfficerMapFarm.tsx',
  'components/officer/OfficerRemapFarm.tsx',
  'components/officer/OfficerFarmDetail.tsx',
];
const MODEL = code('lib/officer/recovery.ts');
const WALK = code('components/officer/BoundaryWalk.tsx');
const RECORD = code('components/officer/OfficerRecordVisit.tsx');
const DETAIL = code('components/officer/OfficerVisitDetail.tsx');

describe('every officer write routes its failure through the model', () => {
  it.each(WRITERS)('%s classifies rather than printing the raw message', (file) => {
    const source = code(file);
    expect(source).toContain('classify(');
    // The old habit: show whatever the server said, whatever it was.
    expect(source).not.toMatch(/\?\.message \?\?/);
  });
});

describe('the dead correction check is gone', () => {
  it('no longer tests a rule key the error body never carries', () => {
    // `unprocessable(rule)` sends code `unprocessable`; the rule key is only
    // ever in the sentence. The old check could not fire.
    expect(DETAIL).not.toContain("=== 'correction_window_closed'");
  });

  it('asks the SERVER whether the window is still open instead of reading prose', () => {
    expect(DETAIL).toMatch(/getVisit\(visit\.id\)[\s\S]{0,200}correctionState\(fresh/);
  });

  it('matches no rule sentence anywhere', () => {
    for (const file of WRITERS) {
      expect(code(file)).not.toMatch(/message\s*===\s*'/);
      expect(code(file)).not.toMatch(/message\?\.includes\(/);
    }
  });
});

describe('GPS failures stay four different things', () => {
  it('both capture screens classify the browser error', () => {
    for (const source of [WALK, RECORD]) {
      expect(source).toContain('classifyFix(error)');
      expect(source).toContain('unsupportedFix()');
    }
  });

  it('neither collapses them into one sentence any more', () => {
    for (const source of [WALK, RECORD]) {
      expect(source).not.toContain('PERMISSION_DENIED');
      expect(source).not.toContain('error.TIMEOUT');
    }
  });

  it('accuracy grading is still the canonical helper, not a new threshold', () => {
    expect(WALK).toContain('gradeOf(');
    expect(MODEL).not.toMatch(/\b(10|30)\s*(?:\)|;|,)/);
    expect(MODEL).not.toContain('accuracy');
  });
});

describe('nothing offline, nothing persisted, nothing global', () => {
  it.each(['localStorage', 'sessionStorage', 'indexedDB', 'serviceWorker', 'navigator.onLine'])(
    'the model never touches %s',
    (api) => {
      expect(MODEL).not.toContain(api);
    },
  );

  it('the model holds no queue, no retry timer and no record of its own', () => {
    for (const word of ['setTimeout', 'setInterval', 'queue', 'pending', 'useState']) {
      expect(MODEL).not.toContain(word);
    }
  });

  it('no screen looks a record up globally to explain why it vanished', () => {
    for (const file of WRITERS) {
      const source = code(file);
      expect(source).not.toContain('listFarmers(');
      expect(source).not.toMatch(/listVisits\(/);
      expect(source).not.toContain('listFarms(');
    }
  });

  it('introduces no client-side duplicate detection', () => {
    for (const word of ['duplicate', 'alreadySubmitted', 'seenBefore']) {
      expect(MODEL.toLowerCase()).not.toContain(word.toLowerCase());
    }
  });
});

describe('authentication is never forced from a failed request', () => {
  it('no officer screen signs the user out or navigates to /login on an error', () => {
    for (const file of WRITERS) {
      const source = code(file);
      expect(source).not.toContain("assign('/login')");
      expect(source).not.toContain('signOut(');
    }
  });

  it('the model separates the outage from the expiry', () => {
    expect(MODEL).toContain('ERROR_CODES.authUnavailable');
    expect(MODEL).toContain('ERROR_CODES.unauthenticated');
  });
});

describe('what the officer reads gives nothing away', () => {
  it('the model never names another officer or attributes a record to one', () => {
    // "This action belongs to a supervisor" names a ROLE and is fine: roles
    // are public. What must never appear is a RECORD attributed to a person,
    // which would confirm the record exists and say whose it is.
    for (const leak of ['another officer', 'owned by', 'assigned to', 'held by']) {
      expect(MODEL.toLowerCase()).not.toContain(leak);
    }
  });

  it('the not-found sentence attributes the record to nobody at all', () => {
    const notFound = classify({ status: 404, code: 'not_found' });
    expect(notFound.explanation.toLowerCase()).not.toMatch(
      /officer|supervisor|administrator|belongs|owned/,
    );
  });

  it('it prints no identifier of its own', () => {
    expect(MODEL).not.toMatch(/\$\{[^}]*\bid\b[^}]*\}/);
  });

  it('uses the shared vocabulary rather than a second one', () => {
    expect(MODEL).toContain("from '@agri-erp/shared'");
    expect(MODEL).toContain('SYNC_OUTCOMES');
  });

  it('hardcodes no language identifier', () => {
    for (const literal of ["'ar-juba'", "'ar'", '"ar"']) {
      expect(MODEL).not.toContain(literal);
    }
  });
});

describe('the recovery styling is field-ready and direction-neutral', () => {
  it.each(['officer-farms.module.css', 'officer-visits.module.css'])(
    '%s uses logical properties only',
    (file) => {
      const css = read(`components/officer/${file}`);
      expect(css).not.toMatch(/\b(padding|margin|border)-(left|right)\b/);
    },
  );

  it('a problem is titled as well as explained, so colour is never the only signal', () => {
    for (const source of [WALK, RECORD]) {
      expect(source).toContain('fixError.title');
      expect(source).toContain('fixError.explanation');
    }
  });
});
