import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

/**
 * The officer farm detail's boundaries, read as source with comments stripped.
 *
 * THE SERVER'S RULES ARE NOT RE-TESTED HERE. `tests/farms.test.ts` already
 * proves against real staging that a farm outside an officer's caseload is a
 * 404, that a supervisor's response has no coordinates key at all rather than
 * a masked one, that superseding leaves both rows with one current, and that
 * removal is administrator-only. This file proves the SCREEN does not work
 * around any of it.
 */
const web = fileURLToPath(new URL('../..', import.meta.url));
const read = (relative: string) => readFileSync(join(web, relative), 'utf8');
const code = (relative: string) =>
  read(relative)
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, ' ')
    .replace(/(^|[^:])\/\/.*$/gm, '$1 ');

const DETAIL = code('components/officer/OfficerFarmDetail.tsx');
const BRANCH = code('components/farms/FarmDetailByRole.tsx');
const MODEL = code('lib/officer/farm-detail.ts');
const FARMER_DETAIL = code('components/officer/OfficerFarmerDetail.tsx');

describe('the route exists and branches by role', () => {
  it('has a page', () => {
    expect(() => read('app/(portal)/farms/[id]/page.tsx')).not.toThrow();
  });

  it('an officer gets the review screen; everyone else keeps the map they have', () => {
    expect(BRANCH).toMatch(/if \(role === 'officer'\) return <OfficerFarmDetail/);
    expect(BRANCH).toContain('/farms');
  });

  it('the farmer detail opens it, carrying THAT farm’s id', () => {
    expect(FARMER_DETAIL).toContain('/farms/${farm.id}`');
    expect(FARMER_DETAIL).toContain('Open farm');
  });
});

describe('it reads only officer-safe routes, and only what it needs', () => {
  it('NEVER the admin national map', () => {
    expect(DETAIL).not.toContain('geojson');
    expect(DETAIL).not.toContain('listFarmGeoJson');
    expect(MODEL).not.toContain('geojson');
  });

  it('fetches this farm and its own boundaries — no global farm list', () => {
    expect(DETAIL).toContain('getFarmRecord(farmId)');
    expect(DETAIL).toContain('listFarmBoundaries(farmId)');
    expect(DETAIL).not.toContain('listFarms(');
    expect(DETAIL).not.toContain('listFarmerFarms(');
  });

  it('does not rebuild the farm from what the farmer page already had', () => {
    // A detail screen fed from a cached list would show whatever that list
    // happened to carry, and would never 404 for a farm out of scope.
    expect(DETAIL).toMatch(/farmId\s*\}\s*:\s*\{\s*farmId:\s*string/);
  });

  it('treats 404 as not-found, indistinguishable from a farm that never existed', () => {
    expect(DETAIL).toMatch(/404/);
    expect(DETAIL).toContain('not on your caseload');
  });

  it('runs no ownership comparison of its own', () => {
    expect(DETAIL).not.toMatch(/caseload_officer_id\s*===/);
    expect(DETAIL).not.toMatch(/mapped_by\s*===/);
  });
});

describe('no administrative action is offered', () => {
  it.each(['removeFarm', 'deleteFarm', 'reassign', 'verifyFarmer'])('never calls %s', (fn) => {
    expect(DETAIL).not.toContain(fn);
    expect(MODEL).not.toContain(fn);
  });

  it('shows no delete or remove control', () => {
    expect(DETAIL).not.toMatch(/>\s*Remove\s*</);
    expect(DETAIL).not.toMatch(/>\s*Delete\s*</);
  });

  it('offers no way to edit a historical boundary’s geometry', () => {
    expect(DETAIL).not.toMatch(/Edit boundary|editGeometry|updateBoundary/);
  });
});

describe('the three states of a shape stay apart', () => {
  it('the model names all three', () => {
    for (const kind of ["'shown'", "'withheld'", "'none'"]) {
      expect(MODEL).toContain(kind);
    }
  });

  it('a WITHHELD shape is not reported as an unwalked one', () => {
    expect(DETAIL).toMatch(/shape\.kind === 'withheld'/);
    expect(DETAIL).toContain('walked by another officer');
    expect(DETAIL).toContain('No boundary has been walked');
  });

  it('the existing SVG is used only when the ring actually arrived', () => {
    expect(DETAIL).toMatch(/shape\.kind === 'shown' && block\.current \?/);
    expect(DETAIL).toContain('<Boundary');
  });

  it('introduces no map library or tile provider', () => {
    for (const lib of ['mapbox', 'leaflet', 'maplibre']) {
      expect(DETAIL.toLowerCase()).not.toContain(lib);
    }
  });
});

describe('area and accuracy come from the server', () => {
  it('renders the stored area, and computes none', () => {
    expect(DETAIL).toContain('block.current.area_ha');
    expect(DETAIL).not.toContain('previewAreaHa');
    expect(MODEL).not.toContain('previewAreaHa');
  });

  it('grades through the canonical function, never a new scale', () => {
    expect(MODEL).toContain('gradeAccuracy');
    for (const invented of ['excellent', 'acceptable', 'high accuracy']) {
      expect(DETAIL.toLowerCase()).not.toContain(invented);
    }
  });

  it('an absent figure is said to be absent, not shown as zero', () => {
    expect(DETAIL).toMatch(/area_ha === undefined/);
    expect(DETAIL).toMatch(/gps_accuracy_m === undefined/);
    expect(DETAIL).toMatch(/point_count === undefined/);
    expect(DETAIL).toContain('not shown');
    expect(DETAIL).not.toMatch(/area_ha \?\? 0/);
    expect(DETAIL).not.toMatch(/gps_accuracy_m \?\? 0/);
  });

  it('a null captured_at is stated as the record moment, never invented', () => {
    expect(DETAIL).toMatch(/captured_at === null/);
  });
});

describe('history keeps current and superseded distinct', () => {
  it('groups them in the model rather than in the view', () => {
    expect(MODEL).toContain('superseded');
    expect(MODEL).toMatch(/find\(\(b\) => b\.is_current\)/);
  });

  it('says a replaced boundary is kept, never that it was removed', () => {
    expect(DETAIL).toContain('replaced, kept on record');
    expect(DETAIL).not.toMatch(/deleted|removed boundary/i);
  });

  it('the history read is the officer-safe boundaries route', () => {
    expect(DETAIL).toContain('listFarmBoundaries(');
  });
});

describe('crops use the canonical vocabulary and the existing contract', () => {
  it('labels from the shared map, never a second list', () => {
    expect(DETAIL).toContain('CROP_LABELS');
    expect(DETAIL).toContain('FARM_CROPS');
    expect(DETAIL).not.toContain("'sorghum'");
  });

  it('edits through the existing PUT, built by the shared schema', () => {
    expect(DETAIL).toContain('declareCrops(');
    expect(DETAIL).toContain('buildCrops(block.season');
  });

  it('says the save REPLACES the season, because the route does', () => {
    expect(DETAIL).toMatch(/replaces what is recorded/i);
  });

  it('does not claim an empty list means nothing was ever declared', () => {
    // The contract cannot tell "never declared" from "declared empty".
    expect(DETAIL).toContain('None recorded for this season.');
    expect(DETAIL).not.toMatch(/no crops declared/i);
  });
});

describe('re-mapping reuses the flow that already exists', () => {
  it('links to it rather than implementing a second one', () => {
    expect(DETAIL).toContain('/farms/${record.id}/remap');
    expect(DETAIL).not.toContain('addBoundary(');
    expect(DETAIL).not.toContain('getCurrentPosition');
  });
});
