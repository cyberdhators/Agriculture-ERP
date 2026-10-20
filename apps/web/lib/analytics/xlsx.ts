/**
 * A SMALL .xlsx WRITER, WITH NO DEPENDENCY (2026-10-22).
 *
 * The owner's decision: the analytics export is a real Excel file carrying
 * the aggregated numbers and a Definitions sheet, and no library is added for
 * it. An .xlsx is a ZIP of a handful of XML parts, and a workbook of numbers
 * and text needs only the parts written here:
 *
 *   [Content_Types].xml, _rels/.rels, xl/workbook.xml,
 *   xl/_rels/workbook.xml.rels, xl/styles.xml, xl/worksheets/sheetN.xml
 *
 * The ZIP entries are STORED (not compressed), each with its CRC-32, which
 * every spreadsheet program reads. Text is written as inline strings, so there
 * is no shared-strings table to keep in step. One style beyond the default:
 * bold, for header rows.
 *
 * NOT HERE, ON PURPOSE: charts (editable charts come later), formulas, dates
 * as serial numbers (dates travel as text, YYYY-MM-DD, so no reader's locale
 * can reinterpret them), merged cells, compression.
 *
 * Pure: no I/O, no clock unless none is given. Tested in xlsx.test.ts, which
 * reads the bytes back.
 */

export type Cell = string | number | null | { readonly text: string; readonly bold: true };

export interface Sheet {
  /** Shown on the tab. Made safe by `safeSheetName`: at most 31 characters. */
  readonly name: string;
  readonly rows: readonly (readonly Cell[])[];
  /** Column widths in characters, first column first. Optional. */
  readonly widths?: readonly number[];
}

// ---------------------------------------------------------------------------
// CRC-32 (the ZIP polynomial, 0xEDB88320 reflected)
// ---------------------------------------------------------------------------

const CRC_TABLE: Uint32Array = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

export function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) {
    crc = CRC_TABLE[(crc ^ bytes[i]!) & 0xff]! ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

// ---------------------------------------------------------------------------
// ZIP, STORED ENTRIES ONLY
// ---------------------------------------------------------------------------

export interface ZipEntry {
  readonly name: string;
  readonly data: Uint8Array;
}

/** MS-DOS time and date, as ZIP headers carry them. Local fields of `when`. */
function dosDateTime(when: Date): { time: number; date: number } {
  const year = Math.max(1980, when.getFullYear());
  return {
    time: (when.getHours() << 11) | (when.getMinutes() << 5) | Math.floor(when.getSeconds() / 2),
    date: ((year - 1980) << 9) | ((when.getMonth() + 1) << 5) | when.getDate(),
  };
}

/** Flag bit 11: the file names are UTF-8. */
const UTF8_NAMES = 0x0800;

/**
 * A ZIP archive of STORED entries: local header and data for each entry, then
 * the central directory, then the end record. No ZIP64: an analytics workbook
 * is kilobytes, and a size over 4 GiB is refused rather than written wrongly.
 */
export function zipStored(entries: readonly ZipEntry[], when: Date = new Date()): Uint8Array {
  const encoder = new TextEncoder();
  const { time, date } = dosDateTime(when);
  const locals: Uint8Array[] = [];
  const centrals: Uint8Array[] = [];
  let offset = 0;

  for (const entry of entries) {
    const name = encoder.encode(entry.name);
    const size = entry.data.length;
    if (size > 0xffffffff) throw new Error(`zipStored: ${entry.name} is too large`);
    const crc = crc32(entry.data);

    const local = new Uint8Array(30 + name.length);
    const lv = new DataView(local.buffer);
    lv.setUint32(0, 0x04034b50, true);
    lv.setUint16(4, 20, true); // version needed: 2.0
    lv.setUint16(6, UTF8_NAMES, true);
    lv.setUint16(8, 0, true); // method: stored
    lv.setUint16(10, time, true);
    lv.setUint16(12, date, true);
    lv.setUint32(14, crc, true);
    lv.setUint32(18, size, true); // compressed size = size
    lv.setUint32(22, size, true);
    lv.setUint16(26, name.length, true);
    lv.setUint16(28, 0, true); // no extra field
    local.set(name, 30);

    const central = new Uint8Array(46 + name.length);
    const cv = new DataView(central.buffer);
    cv.setUint32(0, 0x02014b50, true);
    cv.setUint16(4, 20, true); // version made by
    cv.setUint16(6, 20, true); // version needed
    cv.setUint16(8, UTF8_NAMES, true);
    cv.setUint16(10, 0, true);
    cv.setUint16(12, time, true);
    cv.setUint16(14, date, true);
    cv.setUint32(16, crc, true);
    cv.setUint32(20, size, true);
    cv.setUint32(24, size, true);
    cv.setUint16(28, name.length, true);
    cv.setUint16(30, 0, true); // extra
    cv.setUint16(32, 0, true); // comment
    cv.setUint16(34, 0, true); // disk
    cv.setUint16(36, 0, true); // internal attributes
    cv.setUint32(38, 0, true); // external attributes
    cv.setUint32(42, offset, true);
    central.set(name, 46);

    locals.push(local, entry.data);
    centrals.push(central);
    offset += local.length + size;
  }

  const centralSize = centrals.reduce((n, c) => n + c.length, 0);
  const end = new Uint8Array(22);
  const ev = new DataView(end.buffer);
  ev.setUint32(0, 0x06054b50, true);
  ev.setUint16(4, 0, true);
  ev.setUint16(6, 0, true);
  ev.setUint16(8, entries.length, true);
  ev.setUint16(10, entries.length, true);
  ev.setUint32(12, centralSize, true);
  ev.setUint32(16, offset, true);
  ev.setUint16(20, 0, true); // no comment

  const out = new Uint8Array(offset + centralSize + end.length);
  let at = 0;
  for (const part of [...locals, ...centrals, end]) {
    out.set(part, at);
    at += part.length;
  }
  return out;
}

// ---------------------------------------------------------------------------
// XML AND NAMES
// ---------------------------------------------------------------------------

/** True for a character XML 1.0 refuses: C0 controls other than tab, LF, CR; U+FFFE; U+FFFF. */
const forbiddenInXml = (code: number): boolean =>
  (code < 0x20 && code !== 0x09 && code !== 0x0a && code !== 0x0d) ||
  code === 0xfffe ||
  code === 0xffff;

/**
 * Text made safe inside an XML element or attribute: the five markup
 * characters escaped, and the control characters XML 1.0 forbids removed
 * (Excel refuses a file that carries one). Tab, line feed and carriage
 * return are allowed and kept.
 */
export function escapeXml(text: string): string {
  let kept = '';
  for (let i = 0; i < text.length; i++) {
    if (!forbiddenInXml(text.charCodeAt(i))) kept += text[i];
  }
  return kept
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

export const SHEET_NAME_MAX = 31;

/**
 * A sheet name Excel accepts: no `[ ] : * ? / \`, not blank, not starting or
 * ending with an apostrophe, at most 31 characters, and unique in the workbook
 * ignoring case (a clash gets " (2)", " (3)" ... within the 31).
 */
export function safeSheetName(name: string, taken: Set<string>): string {
  let base = name
    .replace(/[[\]:*?/\\]/g, '-')
    .replace(/^'+|'+$/g, '')
    .trim();
  if (base === '') base = 'Sheet';
  base = base.slice(0, SHEET_NAME_MAX).trim();
  let candidate = base;
  for (let n = 2; taken.has(candidate.toLowerCase()); n++) {
    const suffix = ` (${n})`;
    candidate = base.slice(0, SHEET_NAME_MAX - suffix.length).trimEnd() + suffix;
  }
  taken.add(candidate.toLowerCase());
  return candidate;
}

/** 0 -> A, 25 -> Z, 26 -> AA. */
export function columnName(index: number): string {
  let n = index + 1;
  let out = '';
  while (n > 0) {
    const r = (n - 1) % 26;
    out = String.fromCharCode(65 + r) + out;
    n = Math.floor((n - 1) / 26);
  }
  return out;
}

// ---------------------------------------------------------------------------
// THE WORKBOOK PARTS
// ---------------------------------------------------------------------------

const XML_HEAD = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';
const NS_MAIN = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
const NS_REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const NS_PKG_REL = 'http://schemas.openxmlformats.org/package/2006/relationships';

function cellXml(cell: Cell, ref: string): string {
  if (cell === null || cell === '') return '';
  if (typeof cell === 'number') {
    // NaN and Infinity have no spreadsheet form; they are written as text so
    // a wrong figure is visible rather than silently zero.
    return Number.isFinite(cell)
      ? `<c r="${ref}"><v>${cell}</v></c>`
      : `<c r="${ref}" t="inlineStr"><is><t>${escapeXml(String(cell))}</t></is></c>`;
  }
  const text = typeof cell === 'string' ? cell : cell.text;
  const style = typeof cell === 'string' ? '' : ' s="1"';
  return `<c r="${ref}"${style} t="inlineStr"><is><t xml:space="preserve">${escapeXml(text)}</t></is></c>`;
}

export function sheetXml(sheet: Sheet): string {
  const cols =
    sheet.widths && sheet.widths.length > 0
      ? `<cols>${sheet.widths
          .map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`)
          .join('')}</cols>`
      : '';
  const rows = sheet.rows
    .map((row, r) => {
      const cells = row.map((cell, c) => cellXml(cell, `${columnName(c)}${r + 1}`)).join('');
      return `<row r="${r + 1}">${cells}</row>`;
    })
    .join('');
  return `${XML_HEAD}<worksheet xmlns="${NS_MAIN}">${cols}<sheetData>${rows}</sheetData></worksheet>`;
}

const STYLES_XML =
  `${XML_HEAD}<styleSheet xmlns="${NS_MAIN}">` +
  '<fonts count="2"><font><sz val="11"/><name val="Calibri"/></font>' +
  '<font><b/><sz val="11"/><name val="Calibri"/></font></fonts>' +
  '<fills count="2"><fill><patternFill patternType="none"/></fill>' +
  '<fill><patternFill patternType="gray125"/></fill></fills>' +
  '<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>' +
  '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>' +
  '<cellXfs count="2"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>' +
  '<xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/></cellXfs>' +
  '<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>' +
  '</styleSheet>';

export const XLSX_CONTENT_TYPE =
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

/** The workbook as bytes. At least one sheet; names are made safe here. */
export function buildXlsx(sheets: readonly Sheet[], when: Date = new Date()): Uint8Array {
  if (sheets.length === 0) throw new Error('buildXlsx: a workbook needs at least one sheet');
  const taken = new Set<string>();
  const names = sheets.map((s) => safeSheetName(s.name, taken));
  const encoder = new TextEncoder();
  const part = (name: string, xml: string): ZipEntry => ({ name, data: encoder.encode(xml) });

  const contentTypes =
    `${XML_HEAD}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">` +
    '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
    '<Default Extension="xml" ContentType="application/xml"/>' +
    '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' +
    sheets
      .map(
        (_s, i) =>
          `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`,
      )
      .join('') +
    '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>' +
    '</Types>';

  const rootRels =
    `${XML_HEAD}<Relationships xmlns="${NS_PKG_REL}">` +
    `<Relationship Id="rId1" Type="${NS_REL}/officeDocument" Target="xl/workbook.xml"/>` +
    '</Relationships>';

  const workbook =
    `${XML_HEAD}<workbook xmlns="${NS_MAIN}" xmlns:r="${NS_REL}"><sheets>` +
    names
      .map((n, i) => `<sheet name="${escapeXml(n)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`)
      .join('') +
    '</sheets></workbook>';

  const workbookRels =
    `${XML_HEAD}<Relationships xmlns="${NS_PKG_REL}">` +
    sheets
      .map(
        (_s, i) =>
          `<Relationship Id="rId${i + 1}" Type="${NS_REL}/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`,
      )
      .join('') +
    `<Relationship Id="rId${sheets.length + 1}" Type="${NS_REL}/styles" Target="styles.xml"/>` +
    '</Relationships>';

  return zipStored(
    [
      part('[Content_Types].xml', contentTypes),
      part('_rels/.rels', rootRels),
      part('xl/workbook.xml', workbook),
      part('xl/_rels/workbook.xml.rels', workbookRels),
      part('xl/styles.xml', STYLES_XML),
      ...sheets.map((s, i) => part(`xl/worksheets/sheet${i + 1}.xml`, sheetXml(s))),
    ],
    when,
  );
}
