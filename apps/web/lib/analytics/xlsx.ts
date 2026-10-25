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
 * CHARTS (2026-10-28). A sheet may carry charts: real DrawingML charts
 * (xl/charts/chartN.xml), placed by a drawing (xl/drawings/drawingN.xml) that
 * the sheet points at through its own relationships. Each series REFERENCES
 * cells on the same sheet ('Sheet'!$B$5:$B$20), so the chart is editable in
 * Excel and follows the numbers when they change; a cache of the values is
 * written too, so a reader that does not recalculate still draws it. Line and
 * clustered-column charts only.
 *
 * NOT HERE, ON PURPOSE: formulas, dates as serial numbers (dates travel as
 * text, YYYY-MM-DD, so no reader's locale can reinterpret them), merged
 * cells, compression.
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
  /** Editable charts over this sheet's own cells (2026-10-28). Optional. */
  readonly charts?: readonly ChartSpec[];
}

/**
 * One chart. Every index is zero-based, as `rows` is. The series are the
 * columns `valueCols`; each is named by its cell in `headerRow` and takes its
 * values from `firstRow` to `lastRow`, against the categories in
 * `categoryCol` over the same rows.
 */
export interface ChartSpec {
  readonly kind: 'line' | 'column';
  readonly title: string;
  readonly headerRow: number;
  readonly firstRow: number;
  readonly lastRow: number;
  readonly categoryCol: number;
  readonly valueCols: readonly number[];
  /** The top-left cell it is drawn from, and how many columns and rows it covers. */
  readonly at: {
    readonly col: number;
    readonly row: number;
    readonly cols: number;
    readonly rows: number;
  };
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
    // 2026-10-24 (acceptance QA): "New: first sign-ins" read as
    // "New- first sign-ins"; a colon before a space becomes a spaced dash.
    .replace(/:\s+/g, ' - ')
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

/** `drawingRelId`: the sheet's relationship to its drawing, when it carries charts. */
export function sheetXml(sheet: Sheet, drawingRelId?: string): string {
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
  // <drawing> comes after <sheetData> in the schema's order.
  const drawing = drawingRelId ? `<drawing r:id="${drawingRelId}"/>` : '';
  const ns = drawingRelId ? ` xmlns:r="${NS_REL}"` : '';
  return `${XML_HEAD}<worksheet xmlns="${NS_MAIN}"${ns}>${cols}<sheetData>${rows}</sheetData>${drawing}</worksheet>`;
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

// ---------------------------------------------------------------------------
// CHARTS (2026-10-28)
// ---------------------------------------------------------------------------

const NS_CHART = 'http://schemas.openxmlformats.org/drawingml/2006/chart';
const NS_DRAWING_MAIN = 'http://schemas.openxmlformats.org/drawingml/2006/main';
const NS_SHEET_DRAWING = 'http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing';

const CT_DRAWING = 'application/vnd.openxmlformats-officedocument.drawing+xml';
const CT_CHART = 'application/vnd.openxmlformats-officedocument.drawingml.chart+xml';

/** An absolute reference to cells on a named sheet: 'Name'!$A$1:$A$9. */
export function sheetRef(sheetName: string, col: number, fromRow: number, toRow?: number): string {
  const quoted = `'${sheetName.replace(/'/g, "''")}'`;
  const cell = (r: number) => `$${columnName(col)}$${r + 1}`;
  return toRow === undefined || toRow === fromRow
    ? `${quoted}!${cell(fromRow)}`
    : `${quoted}!${cell(fromRow)}:${cell(toRow)}`;
}

const cellText = (cell: Cell | undefined): string =>
  cell === null || cell === undefined ? '' : typeof cell === 'object' ? cell.text : String(cell);

/** Problems with a chart's ranges, or none. A chart over cells that are not there is refused. */
export function chartProblems(sheet: Sheet, chart: ChartSpec): string[] {
  const problems: string[] = [];
  if (chart.valueCols.length === 0) problems.push('no series');
  if (chart.firstRow > chart.lastRow) problems.push('no data rows');
  if (chart.headerRow >= chart.firstRow) problems.push('the header is not above the data');
  if (chart.lastRow >= sheet.rows.length) problems.push('data rows past the end of the sheet');
  for (const col of chart.valueCols) {
    for (let r = chart.firstRow; r <= Math.min(chart.lastRow, sheet.rows.length - 1); r++) {
      const v = sheet.rows[r]?.[col];
      if (typeof v !== 'number') problems.push(`${columnName(col)}${r + 1} is not a number`);
    }
  }
  return problems;
}

function seriesXml(sheetName: string, sheet: Sheet, chart: ChartSpec, col: number, i: number) {
  const n = chart.lastRow - chart.firstRow + 1;
  const strCache = (values: string[]) =>
    `<c:strCache><c:ptCount val="${values.length}"/>${values
      .map((v, k) => `<c:pt idx="${k}"><c:v>${escapeXml(v)}</c:v></c:pt>`)
      .join('')}</c:strCache>`;
  const categories: string[] = [];
  const values: number[] = [];
  for (let r = chart.firstRow; r <= chart.lastRow; r++) {
    categories.push(cellText(sheet.rows[r]?.[chart.categoryCol]));
    const v = sheet.rows[r]?.[col];
    values.push(typeof v === 'number' ? v : 0);
  }
  const name = cellText(sheet.rows[chart.headerRow]?.[col]);
  const tx = `<c:tx><c:strRef><c:f>${escapeXml(sheetRef(sheetName, col, chart.headerRow))}</c:f>${strCache([name])}</c:strRef></c:tx>`;
  const cat = `<c:cat><c:strRef><c:f>${escapeXml(
    sheetRef(sheetName, chart.categoryCol, chart.firstRow, chart.lastRow),
  )}</c:f>${strCache(categories)}</c:strRef></c:cat>`;
  const val = `<c:val><c:numRef><c:f>${escapeXml(
    sheetRef(sheetName, col, chart.firstRow, chart.lastRow),
  )}</c:f><c:numCache><c:formatCode>General</c:formatCode><c:ptCount val="${n}"/>${values
    .map((v, k) => `<c:pt idx="${k}"><c:v>${v}</c:v></c:pt>`)
    .join('')}</c:numCache></c:numRef></c:val>`;
  const head = `<c:idx val="${i}"/><c:order val="${i}"/>${tx}`;
  // Element order is fixed by the schema: line (marker, cat, val, smooth),
  // bar (invertIfNegative, cat, val).
  return chart.kind === 'line'
    ? `<c:ser>${head}<c:marker><c:symbol val="circle"/><c:size val="5"/></c:marker>${cat}${val}<c:smooth val="0"/></c:ser>`
    : `<c:ser>${head}<c:invertIfNegative val="0"/>${cat}${val}</c:ser>`;
}

/** One chart part: a line or clustered-column chart with a title, axes and a legend. */
export function chartXml(sheetName: string, sheet: Sheet, chart: ChartSpec): string {
  const problems = chartProblems(sheet, chart);
  if (problems.length > 0) {
    throw new Error(`chartXml: "${chart.title}" -- ${problems.join('; ')}`);
  }
  const series = chart.valueCols
    .map((col, i) => seriesXml(sheetName, sheet, chart, col, i))
    .join('');
  const axes = '<c:axId val="500000001"/><c:axId val="500000002"/>';
  const plot =
    chart.kind === 'line'
      ? `<c:lineChart><c:grouping val="standard"/><c:varyColors val="0"/>${series}<c:marker val="1"/>${axes}</c:lineChart>`
      : `<c:barChart><c:barDir val="col"/><c:grouping val="clustered"/><c:varyColors val="0"/>${series}<c:gapWidth val="80"/>${axes}</c:barChart>`;
  return (
    `${XML_HEAD}<c:chartSpace xmlns:c="${NS_CHART}" xmlns:a="${NS_DRAWING_MAIN}" xmlns:r="${NS_REL}">` +
    '<c:roundedCorners val="0"/><c:chart>' +
    `<c:title><c:tx><c:rich><a:bodyPr/><a:p><a:r><a:t>${escapeXml(chart.title)}</a:t></a:r></a:p></c:rich></c:tx><c:overlay val="0"/></c:title>` +
    '<c:autoTitleDeleted val="0"/><c:plotArea><c:layout/>' +
    plot +
    '<c:catAx><c:axId val="500000001"/><c:scaling><c:orientation val="minMax"/></c:scaling>' +
    '<c:delete val="0"/><c:axPos val="b"/><c:numFmt formatCode="General" sourceLinked="1"/>' +
    '<c:tickLblPos val="nextTo"/><c:crossAx val="500000002"/><c:crosses val="autoZero"/>' +
    '<c:auto val="1"/><c:lblAlgn val="ctr"/><c:lblOffset val="100"/><c:noMultiLvlLbl val="0"/></c:catAx>' +
    '<c:valAx><c:axId val="500000002"/><c:scaling><c:orientation val="minMax"/></c:scaling>' +
    '<c:delete val="0"/><c:axPos val="l"/><c:majorGridlines/><c:numFmt formatCode="General" sourceLinked="1"/>' +
    '<c:tickLblPos val="nextTo"/><c:crossAx val="500000001"/><c:crosses val="autoZero"/>' +
    '<c:crossBetween val="between"/></c:valAx>' +
    '</c:plotArea><c:legend><c:legendPos val="b"/><c:overlay val="0"/></c:legend>' +
    '<c:plotVisOnly val="1"/><c:dispBlanksAs val="gap"/></c:chart></c:chartSpace>'
  );
}

/** A drawing placing one chart per anchor; chart k is relationship rId(k+1). */
export function drawingXml(charts: readonly ChartSpec[]): string {
  const anchors = charts
    .map((chart, k) => {
      const { col, row, cols, rows } = chart.at;
      const marker = (tag: string, c: number, r: number) =>
        `<xdr:${tag}><xdr:col>${c}</xdr:col><xdr:colOff>0</xdr:colOff><xdr:row>${r}</xdr:row><xdr:rowOff>0</xdr:rowOff></xdr:${tag}>`;
      return (
        '<xdr:twoCellAnchor>' +
        marker('from', col, row) +
        marker('to', col + cols, row + rows) +
        '<xdr:graphicFrame macro="">' +
        `<xdr:nvGraphicFramePr><xdr:cNvPr id="${k + 2}" name="${escapeXml(`Chart ${k + 1}`)}"/><xdr:cNvGraphicFramePr/></xdr:nvGraphicFramePr>` +
        '<xdr:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/></xdr:xfrm>' +
        `<a:graphic><a:graphicData uri="${NS_CHART}"><c:chart xmlns:c="${NS_CHART}" r:id="rId${k + 1}"/></a:graphicData></a:graphic>` +
        '</xdr:graphicFrame><xdr:clientData/></xdr:twoCellAnchor>'
      );
    })
    .join('');
  return `${XML_HEAD}<xdr:wsDr xmlns:xdr="${NS_SHEET_DRAWING}" xmlns:a="${NS_DRAWING_MAIN}" xmlns:r="${NS_REL}">${anchors}</xdr:wsDr>`;
}

const relsXml = (rels: readonly { id: string; type: string; target: string }[]): string =>
  `${XML_HEAD}<Relationships xmlns="${NS_PKG_REL}">` +
  rels.map((r) => `<Relationship Id="${r.id}" Type="${r.type}" Target="${r.target}"/>`).join('') +
  '</Relationships>';

/** The workbook as bytes. At least one sheet; names are made safe here. */
export function buildXlsx(sheets: readonly Sheet[], when: Date = new Date()): Uint8Array {
  if (sheets.length === 0) throw new Error('buildXlsx: a workbook needs at least one sheet');
  const taken = new Set<string>();
  const names = sheets.map((s) => safeSheetName(s.name, taken));
  const encoder = new TextEncoder();
  const part = (name: string, xml: string): ZipEntry => ({ name, data: encoder.encode(xml) });

  // Drawings are numbered by the sheets that have charts; charts across the workbook.
  const chartParts: ZipEntry[] = [];
  const overrides: string[] = [];
  const sheetParts: ZipEntry[] = [];
  let drawingNo = 0;
  let chartNo = 0;
  sheets.forEach((sheet, i) => {
    const charts = sheet.charts ?? [];
    if (charts.length === 0) {
      sheetParts.push(part(`xl/worksheets/sheet${i + 1}.xml`, sheetXml(sheet)));
      return;
    }
    drawingNo += 1;
    sheetParts.push(part(`xl/worksheets/sheet${i + 1}.xml`, sheetXml(sheet, 'rId1')));
    sheetParts.push(
      part(
        `xl/worksheets/_rels/sheet${i + 1}.xml.rels`,
        relsXml([
          { id: 'rId1', type: `${NS_REL}/drawing`, target: `../drawings/drawing${drawingNo}.xml` },
        ]),
      ),
    );
    const drawingRels: { id: string; type: string; target: string }[] = [];
    for (const [k, chart] of charts.entries()) {
      chartNo += 1;
      chartParts.push(part(`xl/charts/chart${chartNo}.xml`, chartXml(names[i]!, sheet, chart)));
      overrides.push(
        `<Override PartName="/xl/charts/chart${chartNo}.xml" ContentType="${CT_CHART}"/>`,
      );
      drawingRels.push({
        id: `rId${k + 1}`,
        type: `${NS_REL}/chart`,
        target: `../charts/chart${chartNo}.xml`,
      });
    }
    chartParts.push(part(`xl/drawings/drawing${drawingNo}.xml`, drawingXml(charts)));
    chartParts.push(part(`xl/drawings/_rels/drawing${drawingNo}.xml.rels`, relsXml(drawingRels)));
    overrides.push(
      `<Override PartName="/xl/drawings/drawing${drawingNo}.xml" ContentType="${CT_DRAWING}"/>`,
    );
  });

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
    overrides.join('') +
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
      ...sheetParts,
      ...chartParts,
    ],
    when,
  );
}
