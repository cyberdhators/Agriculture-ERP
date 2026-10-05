import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

/**
 * The officer reference shelf's boundaries, read as source with comments
 * stripped — this file explains at length what it refuses to do, and a test
 * matching that prose would pass on the explanation instead of the code.
 */
const web = fileURLToPath(new URL('../..', import.meta.url));
const read = (relative: string) => readFileSync(join(web, relative), 'utf8');
const code = (relative: string) =>
  read(relative)
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, ' ')
    .replace(/(^|[^:])\/\/.*$/gm, '$1 ');

const SCREEN = code('components/officer/OfficerLearning.tsx');
const MODEL = code('lib/officer/learning.ts');
const BRANCH = code('components/library/LibraryByRole.tsx');
const CSS = read('components/officer/officer-learning.module.css');

describe('the officer reaches it through the existing Learning destination', () => {
  it('/library branches by role; the administrator keeps their screen', () => {
    expect(() => read('app/(portal)/library/page.tsx')).not.toThrow();
    expect(BRANCH).toMatch(/role === 'officer' \? <OfficerLearning \/> : <LibraryScreen \/>/);
    expect(BRANCH).toContain("from './LibraryScreen'");
  });

  it('adds no new bottom-navigation destination', () => {
    const nav = code('components/officer/OfficerNav.tsx');
    const items = nav.match(/href: '\/[a-z]+'/g) ?? [];
    expect(items.sort()).toEqual([
      "href: '/desk'",
      "href: '/farmers'",
      "href: '/library'",
      "href: '/visits'",
    ]);
  });
});

describe('it uses the officer-safe routes and no others', () => {
  it('reads the learning list and the weather, both already scoped by the server', () => {
    expect(SCREEN).toContain('listLearningResources(');
    expect(SCREEN).toContain('useWeather(');
  });

  it('narrows nothing for authorisation on the client', () => {
    // The route adds `published = true` for a non-administrator itself. The
    // model may TYPE the field -- it mirrors the row -- but must never filter
    // on it, which would be an authorisation rule living on the client.
    expect(SCREEN).not.toMatch(/\.filter\([^)]*published/);
    expect(MODEL).not.toMatch(/\.filter\([^)]*published/);
    expect(MODEL).not.toMatch(/published\s*===\s*true/);
  });

  it.each([
    'saveLearningResource',
    'removeLearningResource',
    'directory-entries',
    'listDirectoryEntries',
    'reports/summary',
    'listUsers',
    'listOfficers',
    'geojson',
  ])('never reaches for %s', (thing) => {
    expect(SCREEN).not.toContain(thing);
    expect(MODEL).not.toContain(thing);
  });

  it('shows no administrative control', () => {
    for (const control of ['Publish', 'Unpublish', 'Upload', 'New resource', 'Delete']) {
      expect(SCREEN).not.toContain(control);
    }
  });
});

describe('a resource shows only what the route sent', () => {
  it('labels come from the canonical maps, never a private list', () => {
    expect(SCREEN).toContain('TOPIC_LABELS');
    expect(SCREEN).toContain('FORMAT_LABELS');
    expect(SCREEN).toContain('LANGUAGE_LABELS');
    expect(SCREEN).toContain('CROP_LABELS');
    expect(MODEL).toContain('TOPICS = LEARNING_TOPICS');
  });

  it('hardcodes no language identifier, so the ar-juba rename cannot strand it', () => {
    for (const literal of ["'ar-juba'", "'ar'", '"ar-juba"']) {
      expect(SCREEN).not.toContain(literal);
      expect(MODEL).not.toContain(literal);
    }
  });

  it('FABRICATES NO LINK from storage_path — no route turns one into an address', () => {
    expect(SCREEN).not.toMatch(/href=\{[^}]*storage_path/);
    expect(SCREEN).not.toMatch(/src=\{[^}]*storage_path/);
    expect(SCREEN).not.toMatch(/supabase\.co|\/storage\/v1\//);
  });

  it('offers a real way to open a resource, through the signed-link route', () => {
    expect(SCREEN).toContain('getLearningResourceLink(');
    expect(SCREEN).toContain('Open resource');
  });

  it('invents no author, date or download metadata', () => {
    for (const invented of ['author', 'Downloads', 'Published by']) {
      expect(SCREEN).not.toContain(invented);
    }
  });

  it('an empty library is a real answer, not a network excuse', () => {
    expect(SCREEN).toContain('No learning resources available');
    expect(SCREEN).toMatch(/not a\s*\n?\s*problem with your connection/);
  });
});

describe('the weather is reported as the recording it is', () => {
  it('never calls it live, and always shows when it was recorded', () => {
    expect(SCREEN).not.toMatch(/\blive\b/i);
    expect(SCREEN).toContain('Recorded ');
  });

  it('surfaces the server’s own stale flag, in words and not by colour alone', () => {
    expect(MODEL).toContain('location.stale');
    expect(SCREEN).toContain('Older than it should be');
  });

  it('uses no browser geolocation — the contract takes no position', () => {
    expect(SCREEN).not.toContain('navigator.geolocation');
    expect(SCREEN).not.toContain('getCurrentPosition');
  });

  it('calls no third-party weather service from the browser', () => {
    expect(SCREEN).not.toMatch(/openweather|api\.weather|https:\/\/api\./i);
  });

  it('renders the licence attribution the server supplied', () => {
    expect(SCREEN).toContain('attribution.text');
    expect(SCREEN).toContain('attribution.url');
  });

  it('an absent reading is never rendered as a zero', () => {
    expect(MODEL).toMatch(/temp_c !== null/);
    expect(MODEL).toMatch(/rain_mm !== null/);
  });
});

describe('the two sections fail apart', () => {
  it('weather failing leaves the library section standing', () => {
    expect(SCREEN).toMatch(/error \?[\s\S]{0,200}Everything else on this page still works/);
  });

  it('the library failing says the weather still works', () => {
    expect(SCREEN).toContain('The weather above still works');
  });

  it('there is no page-level failure that blanks both', () => {
    expect(SCREEN).not.toMatch(/if \(error\) return <UnavailableState/);
  });
});

describe('nothing offline is simulated', () => {
  it.each(['localStorage', 'sessionStorage', 'indexedDB', 'serviceWorker', 'navigator.onLine'])(
    'never uses %s',
    (api) => {
      expect(SCREEN).not.toContain(api);
      expect(MODEL).not.toContain(api);
    },
  );
});

describe('the layout is ready for right-to-left and for 360px', () => {
  it('uses logical properties only — no physical left/right', () => {
    expect(CSS).not.toMatch(/\b(padding|margin|border)-(left|right)\b/);
    expect(CSS).not.toMatch(/\b(left|right):\s/);
    expect(CSS).toMatch(/padding-inline|margin-inline|border-inline-start/);
  });

  it('bakes no directional arrow into a label', () => {
    expect(SCREEN).not.toMatch(/[←→]/);
  });

  it('nothing is fixed wider than the page cap, so 360px cannot overflow', () => {
    const wide = CSS.match(/(?:inline-size|width):\s*(\d{3,})px/g) ?? [];
    expect(wide.every((m) => m.includes('560'))).toBe(true);
  });

  it('every control clears the 44px touch standard', () => {
    const small = CSS.match(/min-block-size:\s*([0-9]|[1-3][0-9]|4[0-3])px/g) ?? [];
    expect(small).toEqual([]);
    expect(CSS).toContain('min-block-size: 44px');
  });

  it('rows that could crowd at 360px wrap instead', () => {
    expect(CSS).toMatch(/\.topics \{[\s\S]{0,120}flex-wrap: wrap/);
    expect(CSS).toMatch(/\.day \{[\s\S]{0,120}flex-wrap: wrap/);
  });
});

/**
 * OPENING A RESOURCE.
 *
 * The server-side rules -- who may have a link, that an unpublished resource is
 * not found to an officer, that the path comes from the row -- belong to
 * `app/api/learning-resources/[id]/link/route.ts` and are asserted in
 * `tests/learning-resources.test.ts` against real staging. These guard the
 * CLIENT against the shortcuts that would make those rules moot.
 */
describe('a resource is opened through the server, never through a guessed address', () => {
  it('asks for a link only when the officer activates Open', () => {
    // A link issue is an audited access event. Fetching one because a list
    // rendered would record a reading nobody did.
    expect(SCREEN).toMatch(/onClick=\{\(\) => void open\(row\.id\)\}/);
    expect(SCREEN).not.toMatch(/useEffect\([\s\S]{0,200}getLearningResourceLink/);
    expect(SCREEN).not.toMatch(/\.map\([\s\S]{0,160}getLearningResourceLink/);
  });

  it('NEVER builds a URL from storage_path, and names no bucket', () => {
    expect(SCREEN).not.toContain('storage_path');
    expect(SCREEN).not.toMatch(/supabase\.co|\/storage\/v1\/|\/object\/public\//);
    expect(MODEL).not.toMatch(/https?:\/\//);
  });

  it('assumes no file type — one mechanism serves pdf, image, audio and video', () => {
    expect(SCREEN).not.toMatch(/\.pdf|application\/pdf/);
    expect(SCREEN).not.toContain('iframe');
    expect(SCREEN).not.toContain('embed');
  });

  it('opens whatever came back in a new tab, with no viewer of its own', () => {
    expect(SCREEN).toContain("window.open(link.url, '_blank', 'noopener,noreferrer')");
  });

  it('a failure belongs to its row and leaves the shelf usable', () => {
    expect(SCREEN).toContain('openError');
    expect(SCREEN).toMatch(/\[row\.id\]/);
    expect(SCREEN).not.toMatch(/setFailed\(true\)[\s\S]{0,80}getLearningResourceLink/);
  });

  it('says what actually failed — opening, not downloading', () => {
    expect(SCREEN).toContain('Unable to open this resource. Try again.');
    expect(SCREEN).not.toMatch(/download failed/i);
  });

  it('a resource that has gone says so, rather than blaming the network', () => {
    expect(SCREEN).toContain('This resource is no longer available.');
  });

  it('never filters on published to decide what may be opened', () => {
    // Publication is the server's predicate in the WHERE; a client-side check
    // would be authorisation living in the browser.
    expect(SCREEN).not.toMatch(/published\s*(===|&&|\?)/);
  });

  it('keeps nothing on the device — a signed read is an online operation', () => {
    for (const api of ['localStorage', 'sessionStorage', 'indexedDB', 'serviceWorker']) {
      expect(SCREEN).not.toContain(api);
    }
  });

  it('the new action is start-aligned, so it mirrors in RTL', () => {
    expect(CSS).toMatch(/\.openResource \{[\s\S]{0,140}justify-self: start/);
    expect(CSS).toMatch(/\.openResource \{[\s\S]{0,160}min-block-size: 44px/);
  });
});

/**
 * THE LINK ROUTE, READ AS SOURCE.
 *
 * Its behaviour is proved against real staging in
 * `tests/directories-routes.test.ts` -- that an unpublished resource is NOT
 * FOUND to an officer, that the path is the server's, that the issue is
 * audited. Those cannot run without the staging lock, so these cheap guards
 * stand over the invariants in the meantime: a missing predicate or a
 * client-supplied path would be silent until someone took the lock.
 */
describe('the read-link route keeps its own authorization', () => {
  const ROUTE = code('app/api/learning-resources/[id]/link/route.ts');

  it("applies the LIST's publication predicate, in the WHERE", () => {
    expect(ROUTE).toContain("auth.scope.kind !== 'all'");
    expect(ROUTE).toContain('published = true');
  });

  it('reads the path from the row it loaded, never from the request', () => {
    expect(ROUTE).toContain('row.storage_path');
    expect(ROUTE).not.toMatch(/params\.(path|storage_path|bucket)/);
    expect(ROUTE).not.toMatch(/searchParams\.get\(\s*'(path|bucket)'/);
  });

  it('names the bucket from the shared constant, never a literal', () => {
    expect(ROUTE).toContain('LEARNING_RESOURCE_BUCKET');
    expect(ROUTE).not.toMatch(/'learning-resources'/);
  });

  it('answers NOT FOUND rather than forbidden, so probing ids reveals nothing', () => {
    expect(ROUTE).toContain('throw notFound()');
    expect(ROUTE).not.toContain('forbidden()');
  });

  it('refuses a malformed id before reading anything', () => {
    expect(ROUTE).toMatch(/\[0-9a-f\]\{8\}/);
  });

  it('audits the issue, and writes the row BEFORE the link exists', () => {
    expect(ROUTE).toContain("action: 'learning_resource.link_issued'");
    expect(ROUTE.indexOf('writeAudit')).toBeLessThan(ROUTE.indexOf('issueReadLink('));
  });

  it('never records the link itself', () => {
    expect(ROUTE).not.toMatch(/after:[\s\S]{0,120}link\.url/);
  });

  it('issues an EXPIRING link, at the shared lifetime', () => {
    expect(ROUTE).toContain('LEARNING_LIMITS.readLinkSeconds');
  });

  it('is readable by the roles that can already list resources', () => {
    expect(ROUTE).toMatch(/roles: \['admin', 'supervisor', 'read_only', 'officer'\]/);
  });
});
