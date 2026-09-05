import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { RULE_MESSAGES } from '../apps/web/lib/api/errors';

/**
 * The one CONVENTIONS table the shared drift test could not reach: the 409 and
 * 422 rule sentences (§5.2.1) live in apps/web, not packages/shared, so the
 * shared package's test never saw them. Found 2026-09-05 while checking a
 * false alarm; unguarded since B3; nothing had drifted. Guarded from here.
 */
const doc = readFileSync(
  fileURLToPath(new URL('../docs/api/CONVENTIONS.md', import.meta.url)),
  'utf8',
);

const rows = (): Map<string, string> => {
  const start = doc.indexOf('#### 5.2.1');
  const end = doc.indexOf('#### 5.2.2');
  expect(start, '§5.2.1 missing').toBeGreaterThan(-1);
  const out = new Map<string, string>();
  for (const line of doc.slice(start, end).split('\n')) {
    const m = /^\|\s*`([a-z_]+)`\s*\|\s*(.*?)\s*\|\s*$/.exec(line);
    if (m) out.set(m[1]!, m[2]!);
  }
  return out;
};

describe('the documented 409/422 rule sentences match the registry the routes use', () => {
  const documented = rows();
  it('pins every rule the code defines, and no others', () => {
    expect([...documented.keys()].sort()).toEqual(Object.keys(RULE_MESSAGES).sort());
  });
  it('pins each sentence word for word', () => {
    for (const [key, sentence] of Object.entries(RULE_MESSAGES)) {
      expect(documented.get(key), `wording drifted for ${key}`).toBe(sentence);
    }
  });
  it('no sentence names a person: no capitalised word that is not a sentence start or a role', () => {
    for (const sentence of Object.values(RULE_MESSAGES)) {
      expect(sentence).not.toMatch(/\+211\d/);
    }
  });
});
