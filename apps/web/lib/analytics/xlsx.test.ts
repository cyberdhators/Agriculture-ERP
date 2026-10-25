import { describe, expect, it } from 'vitest';

import {
  SHEET_NAME_MAX,
  buildXlsx,
  chartProblems,
  chartXml,
  columnName,
  crc32,
  escapeXml,
  safeSheetName,
  sheetRef,
  sheetXml,
  zipStored,
} from './xlsx';

/**
 * The Excel writer is checked by READING ITS BYTES BACK, the way a spreadsheet
 * program would: the end record leads to the central directory, each central
 * entry leads to its local header, and every entry's CRC is recomputed from
 * the data found there. A writer that only "looks right" fails here.
 */

const text = (s: string) => new TextEncoder().encode(s);
const decode = (b: Uint8Array) => new TextDecoder().decode(b);

interface ReadEntry {
  name: string;
  data: Uint8Array;
  crc: number;
  method: number;
  flags: number;
}

/** A minimal reader for STORED archives: end record -> central directory -> local headers. */
function readZip(zip: Uint8Array): ReadEntry[] {
  const view = new DataView(zip.buffer, zip.byteOffset, zip.byteLength);
  const endAt = zip.length - 22;
  expect(view.getUint32(endAt, true), 'end of central directory signature').toBe(0x06054b50);
  const count = view.getUint16(endAt + 10, true);
  expect(view.getUint16(endAt + 8, true)).toBe(count);
  const cdSize = view.getUint32(endAt + 12, true);
  const cdOffset = view.getUint32(endAt + 16, true);
  expect(cdOffset + cdSize, 'central directory ends where the end record starts').toBe(endAt);

  const entries: ReadEntry[] = [];
  let at = cdOffset;
  for (let i = 0; i < count; i++) {
    expect(view.getUint32(at, true), 'central header signature').toBe(0x02014b50);
    const flags = view.getUint16(at + 8, true);
    const method = view.getUint16(at + 10, true);
    const crc = view.getUint32(at + 16, true);
    const size = view.getUint32(at + 24, true);
    expect(view.getUint32(at + 20, true), 'stored: compressed size is the size').toBe(size);
    const nameLength = view.getUint16(at + 28, true);
    const extra = view.getUint16(at + 30, true);
    const comment = view.getUint16(at + 32, true);
    const localAt = view.getUint32(at + 42, true);
    const name = decode(zip.subarray(at + 46, at + 46 + nameLength));

    expect(view.getUint32(localAt, true), `local header signature for ${name}`).toBe(0x04034b50);
    expect(view.getUint32(localAt + 14, true), `local CRC agrees for ${name}`).toBe(crc);
    expect(view.getUint32(localAt + 22, true)).toBe(size);
    const localName = view.getUint16(localAt + 26, true);
    const localExtra = view.getUint16(localAt + 28, true);
    expect(decode(zip.subarray(localAt + 30, localAt + 30 + localName))).toBe(name);
    const dataAt = localAt + 30 + localName + localExtra;
    const data = zip.subarray(dataAt, dataAt + size);
    entries.push({ name, data, crc, method, flags });
    at += 46 + nameLength + extra + comment;
  }
  return entries;
}

describe('crc32', () => {
  it('gives the standard check value for "123456789"', () => {
    expect(crc32(text('123456789'))).toBe(0xcbf43926);
  });

  it('gives 0 for nothing, and known values for short inputs', () => {
    expect(crc32(new Uint8Array())).toBe(0);
    expect(crc32(text('a'))).toBe(0xe8b7be43);
    expect(crc32(text('The quick brown fox jumps over the lazy dog'))).toBe(0x414fa339);
  });
});

describe('zipStored', () => {
  it('writes local headers, a central directory and an end record that parse back', () => {
    const files = [
      { name: 'a.txt', data: text('hello') },
      { name: 'dir/b.xml', data: text('<x>é</x>') },
      { name: 'empty', data: new Uint8Array() },
    ];
    const entries = readZip(zipStored(files, new Date(2026, 9, 22, 10, 30, 0)));
    expect(entries.map((e) => e.name)).toEqual(['a.txt', 'dir/b.xml', 'empty']);
    for (const [i, e] of entries.entries()) {
      expect(e.method, 'stored, not deflated').toBe(0);
      expect(e.flags & 0x0800, 'names flagged UTF-8').toBe(0x0800);
      expect(decode(e.data)).toBe(decode(files[i]!.data));
      expect(e.crc).toBe(crc32(files[i]!.data));
    }
  });

  it('writes an empty archive as a bare end record', () => {
    const zip = zipStored([]);
    expect(zip.length).toBe(22);
    expect(readZip(zip)).toEqual([]);
  });
});

describe('escapeXml', () => {
  it('escapes the five markup characters', () => {
    expect(escapeXml(`<a href="x">Tom & Jerry's</a>`)).toBe(
      '&lt;a href=&quot;x&quot;&gt;Tom &amp; Jerry&apos;s&lt;/a&gt;',
    );
  });

  it('removes control characters XML forbids and keeps tab and newlines', () => {
    expect(escapeXml('a\u0000b\u0007c\td\ne\rf\u001F')).toBe('abc\td\ne\rf');
  });

  it('keeps Arabic and other text as it is', () => {
    expect(escapeXml('جوبا Juba')).toBe('جوبا Juba');
  });
});

describe('sheet names', () => {
  it('keeps a plain name', () => {
    expect(safeSheetName('Summary', new Set())).toBe('Summary');
  });

  it('cuts a long name to 31 characters', () => {
    const name = safeSheetName('Sign-ins and return sessions in the window', new Set());
    expect(name.length).toBeLessThanOrEqual(SHEET_NAME_MAX);
    expect(name).toBe('Sign-ins and return sessions in');
  });

  it('replaces the characters Excel refuses and strips edge apostrophes', () => {
    expect(safeSheetName(`'a/b\\c[d]e:f*g?h'`, new Set())).toBe('a-b-c-d-e-f-g-h');
    expect(safeSheetName('   ', new Set())).toBe('Sheet');
    expect(safeSheetName('New: first sign-ins', new Set())).toBe('New - first sign-ins');
  });

  it('makes names unique ignoring case, within the limit', () => {
    const taken = new Set<string>();
    expect(safeSheetName('Totals', taken)).toBe('Totals');
    expect(safeSheetName('TOTALS', taken)).toBe('TOTALS (2)');
    const long = 'x'.repeat(40);
    expect(safeSheetName(long, taken)).toBe('x'.repeat(31));
    const second = safeSheetName(long, taken);
    expect(second).toBe(`${'x'.repeat(27)} (2)`);
    expect(second.length).toBe(SHEET_NAME_MAX);
  });
});

describe('columnName', () => {
  it('counts A to Z, then AA', () => {
    expect([0, 1, 25, 26, 27, 51, 52, 701, 702].map(columnName)).toEqual([
      'A',
      'B',
      'Z',
      'AA',
      'AB',
      'AZ',
      'BA',
      'ZZ',
      'AAA',
    ]);
  });
});

describe('buildXlsx', () => {
  const sheets = [
    {
      name: 'Summary',
      rows: [
        [{ text: 'Metric', bold: true as const }, 'Value'],
        ['Listings <new> & sold', 12],
        [null, 3.5],
      ],
      widths: [30, 10],
    },
    { name: 'Definitions', rows: [['A "quoted" word']] },
  ];
  const entries = readZip(buildXlsx(sheets, new Date(2026, 9, 22)));
  const part = (name: string) => {
    const e = entries.find((x) => x.name === name);
    expect(e, `${name} is in the workbook`).toBeDefined();
    return decode(e!.data);
  };

  it('carries exactly the parts a workbook needs', () => {
    expect(entries.map((e) => e.name)).toEqual([
      '[Content_Types].xml',
      '_rels/.rels',
      'xl/workbook.xml',
      'xl/_rels/workbook.xml.rels',
      'xl/styles.xml',
      'xl/worksheets/sheet1.xml',
      'xl/worksheets/sheet2.xml',
    ]);
  });

  it('declares every sheet in the content types, the workbook and its relationships', () => {
    const types = part('[Content_Types].xml');
    expect(types).toContain('PartName="/xl/worksheets/sheet1.xml"');
    expect(types).toContain('PartName="/xl/worksheets/sheet2.xml"');
    expect(types).toContain('PartName="/xl/styles.xml"');
    const workbook = part('xl/workbook.xml');
    expect(workbook).toContain('<sheet name="Summary" sheetId="1" r:id="rId1"/>');
    expect(workbook).toContain('<sheet name="Definitions" sheetId="2" r:id="rId2"/>');
    const rels = part('xl/_rels/workbook.xml.rels');
    expect(rels).toContain('Id="rId1"');
    expect(rels).toContain('Target="worksheets/sheet2.xml"');
    expect(rels).toContain('Id="rId3"');
    expect(rels).toContain('Target="styles.xml"');
    expect(part('_rels/.rels')).toContain('Target="xl/workbook.xml"');
  });

  it('writes numbers as numbers and text as escaped inline strings', () => {
    const sheet = part('xl/worksheets/sheet1.xml');
    expect(sheet).toContain('<c r="B2"><v>12</v></c>');
    expect(sheet).toContain('<c r="B3"><v>3.5</v></c>');
    expect(sheet).toContain('Listings &lt;new&gt; &amp; sold');
    expect(sheet).toContain('<c r="A1" s="1" t="inlineStr">');
    expect(sheet).toContain('<col min="1" max="1" width="30" customWidth="1"/>');
    expect(sheet).not.toContain('r="A3"');
    expect(part('xl/worksheets/sheet2.xml')).toContain('A &quot;quoted&quot; word');
  });

  it('writes a figure that is not a number as visible text, never as a silent zero', () => {
    expect(sheetXml({ name: 'x', rows: [[Number.NaN]] })).toContain('<t>NaN</t>');
  });

  it('refuses a workbook with no sheet', () => {
    expect(() => buildXlsx([])).toThrow(/at least one sheet/);
  });

  it('every XML part is well-formed enough to start with a declaration and close its root', () => {
    for (const e of entries) {
      const xml = decode(e.data);
      expect(xml.startsWith('<?xml version="1.0"')).toBe(true);
      const root = /<([A-Za-z]+)[\s>]/.exec(xml.slice(xml.indexOf('?>') + 2))?.[1];
      expect(xml.trimEnd().endsWith(`</${root}>`), `${e.name} closes <${root}>`).toBe(true);
    }
  });
});

describe('editable charts (2026-10-28)', () => {
  const chartSheet = {
    name: "Farmers' sales",
    rows: [
      [{ text: 'Over time', bold: true as const }],
      [],
      [{ text: 'Day', bold: true as const }, 'Listings', 'Requests'],
      ['2026-10-01', 3, 1],
      ['2026-10-02', 5, 0],
    ],
    charts: [
      {
        kind: 'line' as const,
        title: 'Listings & requests',
        headerRow: 2,
        firstRow: 3,
        lastRow: 4,
        categoryCol: 0,
        valueCols: [1, 2],
        at: { col: 4, row: 0, cols: 8, rows: 15 },
      },
    ],
  };
  const plain = { name: 'Plain', rows: [['x']] };
  const entries = readZip(buildXlsx([plain, chartSheet], new Date(2026, 9, 28)));
  const names = entries.map((e) => e.name);
  const part = (name: string) => {
    const e = entries.find((x) => x.name === name);
    expect(e, `${name} is in the workbook`).toBeDefined();
    return decode(e!.data);
  };

  it('adds a drawing, its chart and every relationship and content type between them', () => {
    expect(names).toEqual(
      expect.arrayContaining([
        'xl/worksheets/_rels/sheet2.xml.rels',
        'xl/drawings/drawing1.xml',
        'xl/drawings/_rels/drawing1.xml.rels',
        'xl/charts/chart1.xml',
      ]),
    );
    expect(names).not.toContain('xl/worksheets/_rels/sheet1.xml.rels');
    expect(part('xl/worksheets/sheet2.xml')).toContain('<drawing r:id="rId1"/></worksheet>');
    expect(part('xl/worksheets/sheet1.xml')).not.toContain('<drawing');
    expect(part('xl/worksheets/_rels/sheet2.xml.rels')).toContain(
      'Target="../drawings/drawing1.xml"',
    );
    expect(part('xl/drawings/drawing1.xml')).toContain('r:id="rId1"');
    expect(part('xl/drawings/_rels/drawing1.xml.rels')).toContain('Target="../charts/chart1.xml"');
    const types = part('[Content_Types].xml');
    expect(types).toContain(
      'PartName="/xl/charts/chart1.xml" ContentType="application/vnd.openxmlformats-officedocument.drawingml.chart+xml"',
    );
    expect(types).toContain(
      'PartName="/xl/drawings/drawing1.xml" ContentType="application/vnd.openxmlformats-officedocument.drawing+xml"',
    );
  });

  it('references the cells on its own sheet, quoted, with the values cached', () => {
    const chart = part('xl/charts/chart1.xml');
    expect(chart).toContain('<c:lineChart>');
    expect(chart).toContain('<c:f>&apos;Farmers&apos;&apos; sales&apos;!$B$4:$B$5</c:f>');
    expect(chart).toContain('<c:f>&apos;Farmers&apos;&apos; sales&apos;!$A$4:$A$5</c:f>');
    expect(chart).toContain('<c:f>&apos;Farmers&apos;&apos; sales&apos;!$C$3</c:f>');
    expect(chart).toContain('<c:pt idx="1"><c:v>5</c:v></c:pt>');
    expect(chart).toContain('<c:v>Requests</c:v>');
    expect(chart).toContain('Listings &amp; requests');
    expect(chart.match(/<c:ser>/g)?.length).toBe(2);
  });

  it('writes a clustered column chart with its schema order', () => {
    const col = chartXml('S', chartSheet, { ...chartSheet.charts[0]!, kind: 'column' });
    expect(col).toContain('<c:barDir val="col"/><c:grouping val="clustered"/>');
    expect(col).toMatch(/<c:invertIfNegative val="0"\/><c:cat>/);
  });

  it('refuses a chart over cells that are missing or not numbers', () => {
    const bad = { ...chartSheet.charts[0]!, lastRow: 9 };
    expect(chartProblems(chartSheet, bad)).toContain('data rows past the end of the sheet');
    expect(chartProblems(chartSheet, { ...bad, lastRow: 4, valueCols: [0] })).toContain(
      'A4 is not a number',
    );
    expect(() => buildXlsx([{ ...chartSheet, charts: [bad] }])).toThrow(/past the end/);
  });

  it('builds sheet references', () => {
    expect(sheetRef('Summary', 1, 4, 9)).toBe("'Summary'!$B$5:$B$10");
    expect(sheetRef("It's", 0, 0)).toBe("'It''s'!$A$1");
  });
});
