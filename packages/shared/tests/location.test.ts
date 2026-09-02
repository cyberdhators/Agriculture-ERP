import { describe, expect, it } from 'vitest';

import {
  LOCATION_MESSAGES,
  canonicaliseTree,
  countyRowSchema,
  locationCodeSchema,
  locationNameSchema,
  locationRowSchema,
  payamRowSchema,
  type LocationTree,
} from '../src/index';

/**
 * The location schemas and the bundle version. Unit B2.
 *
 * These need no database, so unlike the tests in tests/, they run everywhere
 * including CI.
 */

const refused = (
  schema: {
    safeParse: (v: unknown) => { success: boolean; error?: { issues: { message: string }[] } };
  },
  value: unknown,
): string => {
  const r = schema.safeParse(value);
  expect(r.success, `expected ${JSON.stringify(value)} to be refused`).toBe(false);
  return r.error?.issues[0]?.message ?? '';
};

describe('what makes a valid location code', () => {
  it.each(['CE', 'CE-JUB', 'CE-JUB-MUN', 'NB', 'ZZ9-A1'])('accepts %s', (code) => {
    expect(locationCodeSchema.parse(code)).toBe(code);
  });

  it.each([
    ['lower case', 'ce-jub'],
    ['a space inside', 'CE JUB'],
    ['an underscore', 'CE_JUB'],
    ['a leading hyphen', '-CE'],
    ['a trailing hyphen', 'CE-'],
    ['two hyphens together', 'CE--JUB'],
    ['non-Latin characters', 'جوبا'],
  ])('refuses a code with %s', (_label, code) => {
    expect(refused(locationCodeSchema, code)).toBe(LOCATION_MESSAGES.codeFormat);
  });

  it('refuses an empty code', () => {
    expect(refused(locationCodeSchema, '')).toBe(LOCATION_MESSAGES.codeRequired);
  });
});

describe('C-2.8: names are kept exactly as supplied', () => {
  it.each([
    ['Arabic script', 'جوبا'],
    ['a mixed script name', 'Yéi — منوكي'],
    ['an accented Latin name', 'Kajo-Keji'],
    ['a name with an apostrophe', "Wau Shilluk's"],
  ])('keeps %s unchanged', (_label, name) => {
    expect(locationNameSchema.parse(name)).toBe(name);
  });

  it('trims only the whitespace around a cell, never inside the name', () => {
    expect(locationNameSchema.parse('  Northern Bari  ')).toBe('Northern Bari');
    expect(locationNameSchema.parse('Northern  Bari')).toBe('Northern  Bari');
  });

  it('refuses a name that is only spaces', () => {
    expect(refused(locationNameSchema, '   ')).toBe(LOCATION_MESSAGES.nameBlank);
  });
});

describe('what a source row must carry', () => {
  it('a county must name the state it belongs to', () => {
    expect(
      countyRowSchema.parse({ level: 'county', id: 'CE-JUB', name: 'Juba', state_id: 'CE' }),
    ).toEqual({ level: 'county', id: 'CE-JUB', name: 'Juba', state_id: 'CE' });
    expect(countyRowSchema.safeParse({ level: 'county', id: 'CE-JUB', name: 'Juba' }).success).toBe(
      false,
    );
  });

  it('a payam must name both its county and its state', () => {
    const row = {
      level: 'payam',
      id: 'CE-JUB-MUN',
      name: 'Munuki',
      county_id: 'CE-JUB',
      state_id: 'CE',
    };
    expect(payamRowSchema.parse(row)).toEqual(row);
    const withoutState = { ...row } as Partial<typeof row>;
    delete withoutState.state_id;
    expect(payamRowSchema.safeParse(withoutState).success).toBe(false);
  });

  it('refuses a row carrying a column the source should not have', () => {
    expect(
      locationRowSchema.safeParse({
        level: 'state',
        id: 'CE',
        name: 'Central Equatoria',
        population: 1,
      }).success,
    ).toBe(false);
  });

  it('refuses a level that is not one of the three', () => {
    expect(locationRowSchema.safeParse({ level: 'district', id: 'CE', name: 'X' }).success).toBe(
      false,
    );
  });
});

describe('C-2.4: the bundle version changes when, and only when, the content changes', () => {
  const tree: LocationTree = {
    states: [{ id: 'CE', name: 'Central Equatoria' }],
    counties: [{ id: 'CE-JUB', name: 'Juba', state_id: 'CE' }],
    payams: [{ id: 'CE-JUB-MUN', name: 'Munuki', county_id: 'CE-JUB', state_id: 'CE' }],
  };

  it('is identical for the same content', () => {
    expect(canonicaliseTree(tree)).toBe(canonicaliseTree(structuredClone(tree) as LocationTree));
  });

  it('does not change when rows arrive in a different order', () => {
    const reordered: LocationTree = {
      ...tree,
      states: [
        { id: 'ZZ', name: 'Last' },
        { id: 'CE', name: 'Central Equatoria' },
      ],
    };
    const sorted: LocationTree = {
      ...tree,
      states: [
        { id: 'CE', name: 'Central Equatoria' },
        { id: 'ZZ', name: 'Last' },
      ],
    };
    expect(canonicaliseTree(reordered)).toBe(canonicaliseTree(sorted));
  });

  it('changes when a name changes', () => {
    const renamed: LocationTree = {
      ...tree,
      payams: [{ id: 'CE-JUB-MUN', name: 'Munuki North', county_id: 'CE-JUB', state_id: 'CE' }],
    };
    expect(canonicaliseTree(renamed)).not.toBe(canonicaliseTree(tree));
  });

  it('changes when a location is added', () => {
    const added: LocationTree = {
      ...tree,
      payams: [
        ...tree.payams,
        { id: 'CE-JUB-KAT', name: 'Kator', county_id: 'CE-JUB', state_id: 'CE' },
      ],
    };
    expect(canonicaliseTree(added)).not.toBe(canonicaliseTree(tree));
  });

  it('changes when a payam moves to another county', () => {
    const moved: LocationTree = {
      ...tree,
      payams: [{ id: 'CE-JUB-MUN', name: 'Munuki', county_id: 'CE-KAJ', state_id: 'CE' }],
    };
    expect(canonicaliseTree(moved)).not.toBe(canonicaliseTree(tree));
  });

  it('carries no timestamp or counter, so nothing but content can move it', () => {
    const first = canonicaliseTree(tree);
    expect(first).not.toMatch(/\d{4}-\d{2}-\d{2}T/);
    expect(canonicaliseTree(tree)).toBe(first);
  });
});
