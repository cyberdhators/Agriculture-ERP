import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import {
  AUDIT_ACTIONS,
  ERROR_CODES,
  ERROR_MESSAGES,
  FARM_MESSAGES,
  VISIT_MESSAGES,
  SYNC_MESSAGES,
  FARMER_MESSAGES,
  PAGINATION_MESSAGES,
  VERIFICATION_MESSAGES,
  PHONE_MESSAGES,
} from '../src/index';

/**
 * THE DOCUMENT MUST NOT BE ABLE TO DRIFT AWAY FROM THE CODE.
 *
 * Everything built after B1.4 trusts docs/api/CONVENTIONS.md without reading
 * this package. An independent session writes tests from that document alone.
 * If a sentence changes on one side only, that session writes tests against
 * behaviour which no longer exists, its failures are its own, and the
 * independence the project depends on quietly stops working.
 *
 * So this test reads the tables out of the Markdown and compares them to the
 * exported constants. Changing either side alone turns it red. Changing a
 * message means changing both, deliberately, in the same commit.
 */

const conventionsPath = fileURLToPath(new URL('../../../docs/api/CONVENTIONS.md', import.meta.url));
const document = readFileSync(conventionsPath, 'utf8');

/** Returns the rows of the first Markdown table inside a named section. */
const tableRows = (headingText: string): string[][] => {
  const start = document.indexOf(headingText);
  expect(start, `section "${headingText}" is missing from CONVENTIONS.md`).toBeGreaterThan(-1);

  const after = document.slice(start + headingText.length);
  const lines = after.split('\n');
  const rows: string[][] = [];
  let started = false;

  for (const line of lines) {
    const isRow = line.trimStart().startsWith('|');
    if (!isRow) {
      if (started) break;
      continue;
    }
    started = true;
    const cells = line
      .trim()
      .replace(/^\|/, '')
      .replace(/\|$/, '')
      .split('|')
      .map((c) => c.trim());
    // Skip the header row and the ---- separator row.
    if (cells.every((c) => /^-+$/.test(c)) || cells[0] === 'Status' || cells[0] === 'Code')
      continue;
    if (cells[0] === 'Situation' || cells[0] === 'Method' || cells[0] === 'Action key') continue;
    rows.push(cells);
  }

  expect(rows.length, `no table rows found under "${headingText}"`).toBeGreaterThan(0);
  return rows;
};

const unbacktick = (cell: string): string => cell.replace(/`/g, '').trim();

describe('the documented error codes match the ones the code actually defines', () => {
  const documentedCodes = tableRows('## 5. STATUS CODES').map((cells) =>
    unbacktick(cells[1] ?? ''),
  );
  const codesInCode = Object.values(ERROR_CODES);

  it('lists every code the code defines, and no others', () => {
    expect([...documentedCodes].sort()).toEqual([...codesInCode].sort());
  });

  it('gives every documented code a status number', () => {
    for (const cells of tableRows('## 5. STATUS CODES')) {
      expect(cells[0], `status missing for ${cells[1]}`).toMatch(/^\d{3}$/);
    }
  });

  it('says for every code whether a route can emit it today', () => {
    for (const cells of tableRows('## 5. STATUS CODES')) {
      const emitted = unbacktick(cells[3] ?? '').replace(/\*/g, '');
      expect(emitted, `"Emitted today?" missing or unclear for ${cells[1]}`).toMatch(
        /^(Yes|No — B\d)$/,
      );
    }
  });
});

describe('the documented error messages match the ones the code actually sends', () => {
  const documented = new Map(
    tableRows('### 5.2 Every message, exactly').map((cells) => [
      unbacktick(cells[0] ?? ''),
      cells[1] ?? '',
    ]),
  );

  // ERROR_MESSAGES is keyed in camelCase; the document is keyed by wire code.
  const wireCode = (key: string): string => key.replace(/(?<!^)(?=[A-Z])/g, '_').toLowerCase();

  /** Messages that are top-level `message` text, not `fields` reasons. */
  const topLevelKeys = Object.keys(ERROR_MESSAGES).filter(
    (key) => !['unknownField', 'bodyNotExpectedForm'].includes(key),
  );

  it('pins a sentence for every message the code can send', () => {
    for (const key of topLevelKeys) {
      const code = wireCode(key);
      expect(documented.has(code), `${code} is sent by the code but pinned nowhere`).toBe(true);
    }
  });

  it('pins no sentence for a message the code does not send', () => {
    for (const code of documented.keys()) {
      const camel = code.replace(/_(\w)/g, (_m, c: string) => c.toUpperCase());
      expect(topLevelKeys, `${code} is pinned but the code never sends it`).toContain(camel);
    }
  });

  it('pins each sentence word for word', () => {
    for (const key of topLevelKeys) {
      expect(documented.get(wireCode(key)), `wording drifted for ${wireCode(key)}`).toBe(
        ERROR_MESSAGES[key as keyof typeof ERROR_MESSAGES],
      );
    }
  });

  it('leaves 422 unpinned, because the rule that raises it writes its own sentence', () => {
    expect(documented.has('unprocessable')).toBe(false);
    expect(Object.keys(ERROR_MESSAGES)).not.toContain('unprocessable');
  });
});

describe('the documented field reasons match the ones the code actually sends', () => {
  const documented = new Set(
    tableRows('#### 5.2.3 Reasons inside `fields`').map((cells) => cells[1] ?? ''),
  );

  const reasonsInCode = [
    ...Object.values(PHONE_MESSAGES),
    ...Object.values(PAGINATION_MESSAGES),
    ...Object.values(FARMER_MESSAGES),
    ...Object.values(VERIFICATION_MESSAGES),
    ...Object.values(FARM_MESSAGES),
    ...Object.values(VISIT_MESSAGES),
    ...Object.values(SYNC_MESSAGES),
    ERROR_MESSAGES.unknownField,
    ERROR_MESSAGES.bodyNotExpectedForm,
  ];

  it('pins every reason the code can put beside a field name', () => {
    for (const reason of reasonsInCode) {
      expect(documented.has(reason), `this reason is sent but pinned nowhere: "${reason}"`).toBe(
        true,
      );
    }
  });

  it('pins no reason the code never sends', () => {
    for (const reason of documented) {
      expect(reasonsInCode, `this reason is pinned but never sent: "${reason}"`).toContain(reason);
    }
  });

  it('never lets the validation library write a reason for us', () => {
    for (const reason of [...reasonsInCode, ...documented]) {
      expect(
        reason,
        `this reads like library output, not a sentence for an officer: "${reason}"`,
      ).not.toMatch(/^Invalid input|expected \w+, received/i);
    }
  });
});

describe('the documented audit action keys match the ones the code actually writes', () => {
  // B4. The database CHECK is generated from AUDIT_ACTIONS too, so this table,
  // the constant and the constraint are one list seen three ways.
  const documented = tableRows('#### 5.2.2 Audit action keys').map((cells) =>
    unbacktick(cells[0] ?? ''),
  );

  it('pins every action the code can write, and no others', () => {
    expect([...documented].sort()).toEqual([...AUDIT_ACTIONS].sort());
  });

  it('every key is a key, not a sentence', () => {
    for (const key of AUDIT_ACTIONS) expect(key).toMatch(/^[a-z_]+\.[a-z_]+$/);
  });
});
