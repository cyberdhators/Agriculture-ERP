import {
  DEFAULT_LIMIT,
  MAX_LIMIT,
  decodeCursor,
  directoryEntryInputSchema,
  encodeCursor,
} from '@agri-erp/shared';

import { audited, writeAudit } from '../../../lib/api/audit';
import { invalidCursor, unprocessable } from '../../../lib/api/errors';
import { created, defineRoutes, paged } from '../../../lib/api/route';
import { requireWriter } from '../../../lib/api/scope';
import { prisma } from '../../../lib/db';

/**
 * The three directories -- agro-dealer, input supplier, financial service --
 * as one typed table (C-13.1). Unit P1.
 *
 * READ SCOPE (C-13.9): an administrator sees every entry; a supervisor, an
 * officer or a read_only account sees only their own state, and only entries
 * still marked active. Unlike a farmer, a directory entry is reference data,
 * so an officer's read is scoped to their STATE, not to a caseload.
 *
 * SORT: last_verified_at descending, id descending as tiebreak. The table has
 * no created_at; the freshness date is the meaningful order for a directory a
 * farmer is sent to (docs/api/CONVENTIONS.md section 6.2 allows an endpoint to
 * state its own order). The cursor is the (last_verified_at, id) of the last
 * row, exactly as the shared cursor helper encodes it.
 *
 * WRITES are administrator-only. The open question in C-13's notes -- whether
 * an officer may PROPOSE an entry from the field -- is unanswered, so officers
 * have no write route here.
 */

interface DirectoryRow {
  id: string;
  entry_type: string;
  name: string;
  description: string | null;
  services: string[];
  contact_name: string | null;
  phone: string;
  alt_phone: string | null;
  email: string | null;
  physical_address: string | null;
  lat: number | null;
  lng: number | null;
  payam_id: string;
  state_id: string;
  provider_class: string | null;
  last_verified_at: string;
  active: boolean;
}

const present = (row: DirectoryRow) => ({
  id: row.id,
  entry_type: row.entry_type,
  name: row.name,
  description: row.description,
  services: row.services,
  contact_name: row.contact_name,
  phone: row.phone,
  alt_phone: row.alt_phone,
  email: row.email,
  physical_address: row.physical_address,
  location: row.lat === null || row.lng === null ? null : { latitude: row.lat, longitude: row.lng },
  payam_id: row.payam_id,
  state_id: row.state_id,
  provider_class: row.provider_class,
  last_verified_at: row.last_verified_at,
  active: row.active,
});

/**
 * The columns every read returns, including the point pulled back out of the
 * geography and the freshness date as YYYY-MM-DD. Written once so the list, the
 * create and the item route cannot disagree about the shape.
 */
const SELECT_COLUMNS = `id, entry_type::text AS entry_type, name, description, services,
  contact_name, phone, alt_phone, email, physical_address,
  extensions.st_y(location::extensions.geometry) AS lat,
  extensions.st_x(location::extensions.geometry) AS lng,
  payam_id, state_id, provider_class::text AS provider_class,
  to_char(last_verified_at, 'YYYY-MM-DD') AS last_verified_at, active`;

/** The caller's state, whether they hold a state scope or an officer caseload. */
const scopeStateId = (scope: { kind: string; stateId?: string }): string | null =>
  scope.kind === 'state' || scope.kind === 'caseload' ? (scope.stateId ?? null) : null;

export const { GET, POST, PUT, PATCH, DELETE } = defineRoutes({
  GET: {
    roles: ['admin', 'supervisor', 'read_only', 'officer'],
    handler: async ({ request, auth }) => {
      const url = new URL(request.url);
      const rawLimit = url.searchParams.get('limit');
      const rawCursor = url.searchParams.get('cursor');

      let limit = DEFAULT_LIMIT;
      if (rawLimit !== null) {
        const parsed = Number(rawLimit);
        if (!Number.isInteger(parsed) || parsed < 1) throw invalidCursor();
        limit = Math.min(parsed, MAX_LIMIT);
      }

      const where: string[] = [];
      const params: unknown[] = [];

      // A non-administrator is confined to their own state and to active
      // entries; the constraint is the scope, not a filter the caller chose.
      const stateId = scopeStateId(auth.scope);
      if (stateId !== null) {
        params.push(stateId);
        where.push(`state_id = $${params.length}`);
        where.push('active = true');
      }

      // Optional filters. Enum values are compared as text so an unknown value
      // returns nothing rather than failing the enum cast with a 500.
      const entryType = url.searchParams.get('entry_type');
      if (entryType !== null) {
        params.push(entryType);
        where.push(`entry_type::text = $${params.length}`);
      }
      const payamId = url.searchParams.get('payam_id');
      if (payamId !== null) {
        params.push(payamId);
        where.push(`payam_id = $${params.length}`);
      }
      const filterStateId = url.searchParams.get('state_id');
      if (filterStateId !== null) {
        params.push(filterStateId);
        where.push(`state_id = $${params.length}`);
      }

      if (rawCursor !== null) {
        const cursor = decodeCursor(rawCursor);
        if (!cursor) throw invalidCursor();
        params.push(cursor.createdAt, cursor.id);
        where.push(
          `(last_verified_at, id) < ($${params.length - 1}::date, $${params.length}::uuid)`,
        );
      }

      const rows = await prisma.$queryRawUnsafe<DirectoryRow[]>(
        `SELECT ${SELECT_COLUMNS}
         FROM public.directory_entry_active
         ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
         ORDER BY last_verified_at DESC, id DESC
         LIMIT ${limit + 1}`,
        ...params,
      );

      const hasMore = rows.length > limit;
      const page = rows.slice(0, limit);
      const last = page[page.length - 1];

      return paged(page.map(present), {
        cursor:
          hasMore && last ? encodeCursor({ createdAt: last.last_verified_at, id: last.id }) : null,
        hasMore,
      });
    },
  },

  POST: {
    roles: ['admin'],
    bodySchema: directoryEntryInputSchema(),
    handler: async ({ auth, body }) => {
      requireWriter(auth);

      // The payam must exist in the state the body names. Checking the pair in
      // one lookup reuses the composite key's own rule and turns what would
      // otherwise be a 500 from the foreign key into a 422 the caller can act
      // on. state is taken from the row found, so the two cannot disagree.
      const [payam] = await prisma.$queryRawUnsafe<{ id: string; state_id: string }[]>(
        'SELECT id, state_id FROM public.payam_active WHERE id = $1 AND state_id = $2',
        body.payam_id,
        body.state_id,
      );
      if (!payam) throw unprocessable('payam_not_found');

      const lat = body.location ? body.location.latitude : null;
      const lng = body.location ? body.location.longitude : null;

      const row = await audited(prisma, async (tx) => {
        const [inserted] = await tx.$queryRawUnsafe<DirectoryRow[]>(
          `INSERT INTO public.directory_entry
             (entry_type, name, description, services, contact_name, phone, alt_phone, email,
              physical_address, location, payam_id, state_id, provider_class, last_verified_at,
              verified_by, active)
           VALUES ($1::public.directory_entry_type, $2, $3, $4, $5, $6, $7, $8, $9,
                   CASE WHEN $10::double precision IS NULL THEN NULL
                        ELSE extensions.st_setsrid(
                          extensions.st_makepoint($10::double precision, $11::double precision),
                          4326)::extensions.geography END,
                   $12, $13, $14::public.financial_provider_class, $15::date, $16::uuid, $17)
           RETURNING ${SELECT_COLUMNS}`,
          body.entry_type,
          body.name,
          body.description ?? null,
          body.services,
          body.contact_name ?? null,
          body.phone,
          body.alt_phone ?? null,
          body.email ?? null,
          body.physical_address ?? null,
          lng,
          lat,
          payam.id,
          payam.state_id,
          body.provider_class ?? null,
          body.last_verified_at,
          auth.principal.id,
          body.active,
        );
        const createdRow = inserted as DirectoryRow;
        // Changed fields only. Phone, alt_phone and email are stripped by
        // auditSafe even if passed, so they are left out here.
        await writeAudit(tx, {
          entityType: 'directory_entry',
          entityId: createdRow.id,
          actorType: auth.role,
          actorId: auth.principal.id,
          action: 'directory_entry.created',
          after: {
            entry_type: createdRow.entry_type,
            name: createdRow.name,
            payam_id: createdRow.payam_id,
            state_id: createdRow.state_id,
            provider_class: createdRow.provider_class,
            active: createdRow.active,
          },
        });
        return createdRow;
      });

      return created(present(row));
    },
  },
});
