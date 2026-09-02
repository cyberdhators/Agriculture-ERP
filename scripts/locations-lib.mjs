// Shared helpers for the location seed, reseed and bundle. Unit B2.
//
// The source of truth for locations is a CSV supplied by CORWADO under
// Inception Report input I-07. Until it arrives, PLACEHOLDER data is used and
// is marked as such everywhere it can be seen.

import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { URL, fileURLToPath } from 'node:url';

import { canonicaliseTree, locationRowSchema } from '../packages/shared/src/location.ts';

/**
 * CORWADO's list, when it arrives. LOCATIONS_CSV overrides the path so the
 * reseed can be driven against a different source -- which is how the refusal
 * behaviour in C-2.7 is tested without touching the real file.
 */
export const SOURCE_CSV =
  process.env.LOCATIONS_CSV ??
  fileURLToPath(new URL('../docs/data/locations.csv', import.meta.url));

/** True when CORWADO's real list is present. */
export const hasRealSource = () => existsSync(SOURCE_CSV);

export const PLACEHOLDER_BANNER =
  '*** PLACEHOLDER LOCATION DATA -- NOT CORWADO SOURCE DATA (input I-07) ***';

/**
 * PLACEHOLDER. The ten states of South Sudan, the counties of Central
 * Equatoria, and the payams of Juba County.
 *
 * These are best-knowledge names and codes, NOT a CORWADO source list. The
 * codes in particular are invented for this project and will not match the
 * boundary lists when they arrive. Replace wholesale by putting the real file
 * at docs/data/locations.csv and running the reseed.
 */
const PLACEHOLDER_ROWS = [
  ['state', 'CE', 'Central Equatoria'],
  ['state', 'EE', 'Eastern Equatoria'],
  ['state', 'WE', 'Western Equatoria'],
  ['state', 'JG', 'Jonglei'],
  ['state', 'UY', 'Unity'],
  ['state', 'UN', 'Upper Nile'],
  ['state', 'WR', 'Warrap'],
  ['state', 'NB', 'Northern Bahr el Ghazal'],
  ['state', 'WB', 'Western Bahr el Ghazal'],
  ['state', 'LK', 'Lakes'],

  ['county', 'CE-JUB', 'Juba', 'CE'],
  ['county', 'CE-KAJ', 'Kajo-Keji', 'CE'],
  ['county', 'CE-LAI', 'Lainya', 'CE'],
  ['county', 'CE-MOR', 'Morobo', 'CE'],
  ['county', 'CE-TER', 'Terekeka', 'CE'],
  ['county', 'CE-YEI', 'Yei River', 'CE'],

  ['payam', 'CE-JUB-JUB', 'Juba', 'CE-JUB', 'CE'],
  ['payam', 'CE-JUB-KAT', 'Kator', 'CE-JUB', 'CE'],
  ['payam', 'CE-JUB-MUN', 'Munuki', 'CE-JUB', 'CE'],
  ['payam', 'CE-JUB-NBA', 'Northern Bari', 'CE-JUB', 'CE'],
  ['payam', 'CE-JUB-REJ', 'Rejaf', 'CE-JUB', 'CE'],
  ['payam', 'CE-JUB-GAN', 'Ganji', 'CE-JUB', 'CE'],
  ['payam', 'CE-JUB-LOK', 'Lokiliri', 'CE-JUB', 'CE'],
  ['payam', 'CE-JUB-LOB', 'Lobonok', 'CE-JUB', 'CE'],
  ['payam', 'CE-JUB-GON', 'Gondokoro', 'CE-JUB', 'CE'],
  ['payam', 'CE-JUB-DOL', 'Dolo', 'CE-JUB', 'CE'],
  ['payam', 'CE-JUB-BUN', 'Bungu', 'CE-JUB', 'CE'],
  ['payam', 'CE-JUB-MAN', 'Mangalla', 'CE-JUB', 'CE'],
];

const HEADERS = ['level', 'id', 'name', 'county_id', 'state_id'];

/** Splits one CSV line, honouring double quotes. Names may contain commas. */
function splitCsvLine(line) {
  const out = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (quoted) {
      if (ch === '"' && line[i + 1] === '"') {
        cell += '"';
        i += 1;
      } else if (ch === '"') quoted = false;
      else cell += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ',') {
      out.push(cell);
      cell = '';
    } else cell += ch;
  }
  out.push(cell);
  return out;
}

/** Turns raw rows into validated LocationRow objects, or throws with every fault listed. */
function validateRows(rawRows) {
  const rows = [];
  const faults = [];
  rawRows.forEach((raw, index) => {
    const candidate = { level: raw[0], id: raw[1], name: raw[2] };
    if (raw[0] === 'county') candidate.state_id = raw[3];
    if (raw[0] === 'payam') {
      candidate.county_id = raw[3];
      candidate.state_id = raw[4];
    }
    const parsed = locationRowSchema.safeParse(candidate);
    if (parsed.success) rows.push(parsed.data);
    else {
      for (const issue of parsed.error.issues) {
        faults.push(
          `  row ${index + 1} (${raw[1] ?? '?'}): ${issue.path.join('.') || 'row'} -- ${issue.message}`,
        );
      }
    }
  });
  if (faults.length > 0) {
    throw new Error(`The location source has ${faults.length} problem(s):\n${faults.join('\n')}`);
  }
  return rows;
}

/**
 * Loads the location source: CORWADO's CSV if present, the placeholder set
 * otherwise. Every row is validated by the shared Zod schemas before it can
 * reach the database.
 */
export function loadSource() {
  if (!hasRealSource()) {
    return { placeholder: true, rows: validateRows(PLACEHOLDER_ROWS) };
  }
  const text = readFileSync(SOURCE_CSV, 'utf8');
  const lines = text.split(/\r?\n/).filter((l) => l.trim() !== '');
  const header = splitCsvLine(lines[0]).map((h) => h.trim());
  const missing = HEADERS.slice(0, 3).filter((h) => !header.includes(h));
  if (missing.length > 0) {
    throw new Error(`${SOURCE_CSV} is missing column(s): ${missing.join(', ')}`);
  }
  const at = (cells, name) =>
    header.includes(name) ? (cells[header.indexOf(name)] ?? '').trim() : '';
  const raw = lines.slice(1).map((line) => {
    const cells = splitCsvLine(line);
    return [
      at(cells, 'level'),
      at(cells, 'id'),
      at(cells, 'name'),
      at(cells, 'county_id') || at(cells, 'state_id'),
      at(cells, 'state_id'),
    ];
  });
  return { placeholder: false, rows: validateRows(raw) };
}

/** Splits validated rows into the three levels. */
export function toTree(rows) {
  return {
    states: rows.filter((r) => r.level === 'state').map((r) => ({ id: r.id, name: r.name })),
    counties: rows
      .filter((r) => r.level === 'county')
      .map((r) => ({ id: r.id, name: r.name, state_id: r.state_id })),
    payams: rows
      .filter((r) => r.level === 'payam')
      .map((r) => ({ id: r.id, name: r.name, county_id: r.county_id, state_id: r.state_id })),
  };
}

/**
 * The bundle version identifier: SHA-256 of the canonical serialisation.
 *
 * C-2.4 requires it change when, and only when, the content changes. A hash
 * satisfies both halves; a timestamp or a counter satisfies only the first.
 */
export const versionOf = (tree) =>
  createHash('sha256').update(canonicaliseTree(tree)).digest('hex');

/** Reads the live hierarchy from the ACTIVE VIEWS, never the base tables. */
export async function readLiveTree(prisma) {
  // Sequential, not Promise.all. Three concurrent queries open three
  // connections and, on a link that drops roughly one in three, triple the
  // chance the whole read fails. This is one connection reused.
  const states = await prisma.$queryRawUnsafe(
    'SELECT id, name FROM public.state_active ORDER BY id',
  );
  const counties = await prisma.$queryRawUnsafe(
    'SELECT id, name, state_id FROM public.county_active ORDER BY id',
  );
  const payams = await prisma.$queryRawUnsafe(
    'SELECT id, name, county_id, state_id FROM public.payam_active ORDER BY id',
  );
  return { states, counties, payams };
}

/**
 * Counts records that depend on a location, WITHOUT naming any table.
 *
 * Hardcoding `farmer`, `officer` and `cooperative` would be worse than useless:
 * those tables do not exist yet, and a guard naming a table that never appears
 * refuses nothing, forever, while looking like it works. That is the B1.3
 * failure mode exactly -- see docs/DECISIONS.md.
 *
 * Instead this asks the database which foreign keys point at the location table
 * and counts through those. When B5 adds `farmer` with a key to `payam`, this
 * starts protecting it with no change here.
 *
 * LIMIT, stated: it sees dependants declared as FOREIGN KEYS. A future table
 * storing a payam code as loose text with no key is invisible to it. That is an
 * argument for always declaring the key.
 */
export async function dependantsOf(prisma, table, id) {
  const refs = await prisma.$queryRawUnsafe(
    `SELECT con.conname AS constraint_name,
            src.relname AS child_table,
            att.attname AS child_column
     FROM pg_constraint con
     JOIN pg_class     tgt ON tgt.oid = con.confrelid
     JOIN pg_class     src ON src.oid = con.conrelid
     JOIN pg_namespace tn  ON tn.oid  = tgt.relnamespace
     JOIN unnest(con.conkey) WITH ORDINALITY AS k(attnum, ord) ON true
     JOIN pg_attribute att ON att.attrelid = con.conrelid AND att.attnum = k.attnum
     JOIN unnest(con.confkey) WITH ORDINALITY AS f(attnum, ord) ON f.ord = k.ord
     JOIN pg_attribute fatt ON fatt.attrelid = con.confrelid AND fatt.attnum = f.attnum
     WHERE con.contype = 'f' AND tn.nspname = 'public'
       AND tgt.relname = $1 AND fatt.attname = 'id' AND src.relname <> tgt.relname`,
    table,
  );

  const found = [];
  for (const ref of refs) {
    const [{ n }] = await prisma.$queryRawUnsafe(
      `SELECT count(*)::int AS n FROM public."${ref.child_table}" WHERE "${ref.child_column}" = $1`,
      id,
    );
    if (n > 0) found.push({ table: ref.child_table, column: ref.child_column, count: n });
  }
  return found;
}

/**
 * A Prisma client for operational scripts and database tests.
 *
 * Deliberately DIRECT_URL, not DATABASE_URL. DATABASE_URL is the TRANSACTION
 * pooler: it is right for the application, which makes many short stateless
 * queries, and wrong here. Seeding, reseeding and bundling run interactive
 * transactions, which transaction-mode pooling does not properly support, and
 * it is measurably the less reliable of the two on this project.
 *
 * DIRECT_URL is the session pooler. See the known condition in
 * docs/PROJECT-STATE.md.
 */
export function makePrisma(PrismaClient) {
  const url = process.env.DIRECT_URL ?? process.env.DATABASE_URL;
  return new PrismaClient({ datasources: { db: { url } } });
}
