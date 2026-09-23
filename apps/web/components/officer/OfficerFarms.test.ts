import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

/**
 * The officer farm screens' boundaries, read as source with comments stripped.
 *
 * THE SERVER'S RULES ARE NOT RE-TESTED HERE. `tests/farms.test.ts` already
 * proves against real staging that an administrator cannot map, that an
 * officer cannot map or re-map outside their caseload, that an unclosed ring,
 * a crossing one and three vertices are each refused with their own sentence,
 * that the area is within 1% of an independent calculation, that winding does
 * not matter, that 10 and 30 metres grade good and poor, that superseding
 * keeps both rows, and that a supervisor's response has no coordinates key at
 * all. Repeating those against mocks would add confidence in nothing.
 */
const web = fileURLToPath(new URL('../..', import.meta.url));
const read = (relative: string) => readFileSync(join(web, relative), 'utf8');
const code = (relative: string) =>
  read(relative)
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, ' ')
    .replace(/(^|[^:])\/\/.*$/gm, '$1 ');

const WALK = code('components/officer/BoundaryWalk.tsx');
const MAP = code('components/officer/OfficerMapFarm.tsx');
const REMAP = code('components/officer/OfficerRemapFarm.tsx');
const TRACE = code('components/officer/WalkTrace.tsx');
const MODEL = code('lib/officer/farm-mapping.ts');
const FARMER_DETAIL = code('components/officer/OfficerFarmerDetail.tsx');
const MAP_BRANCH = code('components/farms/MapFarmByRole.tsx');
const REMAP_BRANCH = code('components/farms/RemapFarmByRole.tsx');

describe('the routes these screens link to exist', () => {
  it.each([
    'app/(portal)/farmers/[id]/farms/new/page.tsx',
    'app/(portal)/farms/[id]/remap/page.tsx',
  ])('%s', (page) => {
    expect(() => read(page)).not.toThrow();
  });

  it('the farmer detail offers both, carrying THAT farmer’s and THAT farm’s id', () => {
    expect(FARMER_DETAIL).toContain('/farmers/${farmer.id}/farms/new');
    expect(FARMER_DETAIL).toContain('/farms/${farm.id}/remap');
  });
});

describe('THE ADMIN-ONLY MAP IS NEVER TOUCHED', () => {
  it.each([WALK, MAP, REMAP, TRACE, MODEL])('no geojson route, no map fetch', (source) => {
    expect(source).not.toContain('geojson');
    expect(source).not.toContain('listFarmGeoJson');
  });

  it('no global farm list is fetched either', () => {
    for (const source of [WALK, MAP, REMAP]) {
      expect(source).not.toContain('listFarms(');
    }
  });

  it('no map library or tile layer is introduced — the trace is drawn from the readings', () => {
    for (const lib of ['mapbox', 'leaflet', 'maplibre', 'tile']) {
      expect(TRACE.toLowerCase()).not.toContain(lib);
    }
    expect(TRACE).toContain('svg');
  });
});

describe('only an officer maps, and only for their own farmer', () => {
  it('both screens are behind a role branch that tells everyone else plainly', () => {
    expect(MAP_BRANCH).toMatch(/if \(role === 'officer'\) return <OfficerMapFarm/);
    expect(REMAP_BRANCH).toMatch(/if \(role === 'officer'\) return <OfficerRemapFarm/);
    // And everyone else is told, rather than shown a form that would 403.
    expect(MAP_BRANCH).toContain('Only an extension officer maps a farm');
    expect(REMAP_BRANCH).toContain('Only an extension officer maps a farm');
  });

  it('the farmer is the URL’s, never chosen from a list', () => {
    expect(MAP).toMatch(/farmerId\s*\}\s*:\s*\{\s*farmerId:\s*string/);
    expect(MAP).not.toContain('listFarmers(');
    expect(MAP).toMatch(/createFarm\(\s*farmer\.id/);
  });

  it('treats 404 as not-found, the same as a farmer who never existed', () => {
    expect(MAP).toMatch(/404/);
    expect(REMAP).toMatch(/404/);
  });

  it('runs no ownership comparison of its own', () => {
    for (const source of [MAP, REMAP]) {
      expect(source).not.toMatch(/caseload_officer_id\s*===/);
    }
  });

  it.each(['removeFarm', 'reassign', 'verifyFarmer', 'rejectFarmer', 'mergeFarmer'])(
    'never calls %s',
    (fn) => {
      for (const source of [WALK, MAP, REMAP, MODEL]) {
        expect(source).not.toContain(fn);
      }
    },
  );
});

describe('GPS comes from the device, discretely, and is never invented', () => {
  it('reads one position per corner', () => {
    expect(WALK).toContain('navigator.geolocation.getCurrentPosition');
    expect(WALK).toContain('maximumAge: 0');
  });

  it('DOES NOT TRACK CONTINUOUSLY — the contract stores corners, not a trail', () => {
    expect(WALK).not.toContain('watchPosition');
  });

  it('handles denied, timed out and unavailable separately, and allows another try', () => {
    // The four cases moved into `lib/officer/recovery.ts`, where they are
    // tested by behaviour rather than by the presence of a constant name.
    expect(WALK).toContain('classifyFix(error)');
    expect(WALK).toContain('unsupportedFix()');
    expect(WALK).toContain('fixError.title');
  });

  it('keeps nothing on the device', () => {
    for (const api of ['localStorage', 'sessionStorage', 'indexedDB', 'serviceWorker']) {
      expect(WALK).not.toContain(api);
      expect(MODEL).not.toContain(api);
    }
  });

  it('has no fabricated coordinates anywhere: no 0,0, no typed latitude', () => {
    for (const source of [WALK, MAP, REMAP, MODEL]) {
      expect(source).not.toMatch(/coordinates:\s*\[\s*0\s*,\s*0\s*\]/);
      expect(source).not.toMatch(/longitude:\s*0\b/);
      expect(source).not.toMatch(/latitude:\s*0\b/);
    }
    // No box to type a coordinate into, anywhere.
    expect(WALK).not.toMatch(/label="Longitude"|label="Latitude"/);
  });

  it('does not borrow the farmer’s location as a boundary point', () => {
    expect(WALK).not.toContain('payam_id');
    expect(MAP).not.toMatch(/points[\s\S]{0,60}farmer\./);
  });
});

describe('accuracy and area come from the canonical sources', () => {
  it('grades through the shared function, never a word of its own', () => {
    expect(MODEL).toContain('gradeAccuracy');
    for (const invented of ['excellent', 'acceptable', 'high accuracy']) {
      expect(WALK.toLowerCase()).not.toContain(invented);
    }
  });

  it('the on-screen area while walking is labelled an estimate', () => {
    expect(WALK).toMatch(/estimate/i);
    expect(WALK).toContain('calculated by the\n          server');
  });

  it('the estimate is never sent — there is no area field on the contract', () => {
    expect(MODEL).not.toMatch(/area_ha:\s*/);
    expect(MODEL).not.toMatch(/body\.area/);
  });

  it('after saving, the SERVER’s area is what is shown', () => {
    expect(MAP).toContain('farm.farm.area_ha');
    expect(REMAP).toContain('added.area_ha');
  });

  it('accepts no typed area anywhere', () => {
    for (const source of [WALK, MAP, REMAP]) {
      expect(source).not.toMatch(/label="Area"/);
    }
  });
});

describe('absent stays absent', () => {
  it('an unread accuracy is said to be unread, not shown as zero', () => {
    expect(WALK).toMatch(/worst === null/);
    expect(WALK).toContain('not yet read');
  });

  it('an area that was not returned is said so rather than rendered as 0 ha', () => {
    expect(MAP).toMatch(/area_ha === undefined/);
  });

  it('an empty walk draws nothing rather than an empty plot', () => {
    expect(TRACE).toMatch(/points\.length === 0/);
    expect(TRACE).toContain('No corners marked yet');
  });
});

describe('seasons and crops follow the contract', () => {
  it('season options are derived from the shared names and pattern', () => {
    expect(MODEL).toContain('SEASON_NAMES');
    expect(MODEL).toContain('SEASON_PATTERN');
    expect(MODEL).not.toMatch(/'2026-main'/);
  });

  it('claims nothing about a season being open — the backend has no such idea', () => {
    for (const word of ['open season', 'active season', 'season is closed']) {
      expect(WALK.toLowerCase()).not.toContain(word);
    }
  });

  it('crops use the canonical list and labels, never a second vocabulary', () => {
    expect(MODEL).toContain('FARM_CROPS = CROPS');
    expect(MAP).toContain('CROP_LABELS');
    expect(MAP).not.toContain("'sorghum'");
  });

  it('crops are declared only after the farm exists', () => {
    expect(MAP).toMatch(/if \(saved\) return <Mapped/);
    expect(MAP).toMatch(/declareCrops\(farm\.farm\.id/);
  });
});

describe('re-mapping adds a boundary; it never edits one', () => {
  it('posts a new boundary rather than patching the farm', () => {
    expect(REMAP).toContain('addBoundary(');
    expect(REMAP).not.toContain('PATCH');
    expect(REMAP).not.toMatch(/updateFarm|editBoundary/);
  });

  it('shows the history, so what is being superseded is visible and kept', () => {
    expect(REMAP).toContain('listFarmBoundaries(');
    expect(REMAP).toContain('superseded');
  });

  it('says when a season already has a boundary, before it is replaced', () => {
    expect(REMAP).toMatch(/replacing/);
  });
});
