import { directoryEntryInputSchema, toIso } from '@agri-erp/shared';

import { audited, writeAudit } from '../../../../lib/api/audit';
import { notFound, unprocessable } from '../../../../lib/api/errors';
import { defineRoutes, empty, ok } from '../../../../lib/api/route';
import { requireWriter } from '../../../../lib/api/scope';
import { prisma } from '../../../../lib/db';

/**
 * A single directory entry (C-13.1). Unit P1. Writes are administrator-only;
 * the item route mirrors the officers item route: load the row the caller may
 * see or 404, then edit or soft-delete it inside one audited transaction.
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

const SELECT_COLUMNS = `id, entry_type::text AS entry_type, name, description, services,
  contact_name, phone, alt_phone, email, physical_address,
  extensions.st_y(location::extensions.geometry) AS lat,
  extensions.st_x(location::extensions.geometry) AS lng,
  payam_id, state_id, provider_class::text AS provider_class,
  to_char(last_verified_at, 'YYYY-MM-DD') AS last_verified_at, active`;

/**
 * Loads a directory entry, or 404. Reads directory_entry_active, so a
 * soft-deleted row is invisible; the administrative `active` flag is not a
 * filter here -- an administrator edits inactive entries too. Out of scope and
 * does-not-exist are the same response (C-3.5).
 */
async function loadVisible(id: string): Promise<DirectoryRow> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) throw notFound();
  const [row] = await prisma.$queryRawUnsafe<DirectoryRow[]>(
    `SELECT ${SELECT_COLUMNS} FROM public.directory_entry_active WHERE id = $1::uuid`,
    id,
  );
  if (!row) throw notFound();
  return row;
}

export const { GET, POST, PUT, PATCH, DELETE } = defineRoutes({
  PATCH: {
    roles: ['admin'],
    bodySchema: directoryEntryInputSchema(),
    handler: async ({ auth, body, params }) => {
      requireWriter(auth);
      const target = await loadVisible(params.id ?? '');

      // The payam must exist in the state the body names; the row found decides
      // the pair, so the two columns cannot disagree.
      const [payam] = await prisma.$queryRawUnsafe<{ id: string; state_id: string }[]>(
        'SELECT id, state_id FROM public.payam_active WHERE id = $1 AND state_id = $2',
        body.payam_id,
        body.state_id,
      );
      if (!payam) throw unprocessable('payam_not_found');

      const lat = body.location ? body.location.latitude : null;
      const lng = body.location ? body.location.longitude : null;

      const row = await audited(prisma, async (tx) => {
        const [updated] = await tx.$queryRawUnsafe<DirectoryRow[]>(
          `UPDATE public.directory_entry
           SET entry_type = $2::public.directory_entry_type, name = $3, description = $4,
               services = $5, contact_name = $6, phone = $7, alt_phone = $8, email = $9,
               physical_address = $10,
               location = CASE WHEN $11::double precision IS NULL THEN NULL
                               ELSE extensions.st_setsrid(
                                 extensions.st_makepoint($11::double precision, $12::double precision),
                                 4326)::extensions.geography END,
               payam_id = $13, state_id = $14,
               provider_class = $15::public.financial_provider_class,
               last_verified_at = $16::date, active = $17
           WHERE id = $1::uuid AND deleted_at IS NULL
           RETURNING ${SELECT_COLUMNS}`,
          target.id,
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
          body.active,
        );
        if (!updated) throw notFound();
        const next = updated as DirectoryRow;

        // Changed fields only. Phone, alt_phone and email are stripped by
        // auditSafe even if they change, so they are left out of the diff.
        const before: Record<string, unknown> = {};
        const after: Record<string, unknown> = {};
        for (const [key, was, now] of [
          ['entry_type', target.entry_type, next.entry_type],
          ['name', target.name, next.name],
          ['description', target.description, next.description],
          ['contact_name', target.contact_name, next.contact_name],
          ['physical_address', target.physical_address, next.physical_address],
          ['payam_id', target.payam_id, next.payam_id],
          ['state_id', target.state_id, next.state_id],
          ['provider_class', target.provider_class, next.provider_class],
          ['last_verified_at', target.last_verified_at, next.last_verified_at],
        ] as const) {
          if (was !== now) {
            before[key] = was;
            after[key] = now;
          }
        }
        if (target.active !== next.active) {
          before.active = target.active;
          after.active = next.active;
        }
        // services is an array; compare by content and record the arrays.
        if (target.services.join('\u0000') !== next.services.join('\u0000')) {
          before.services = target.services;
          after.services = next.services;
        }
        if (Object.keys(after).length > 0) {
          await writeAudit(tx, {
            entityType: 'directory_entry',
            entityId: next.id,
            actorType: auth.role,
            actorId: auth.principal.id,
            action: 'directory_entry.updated',
            before,
            after,
          });
        }
        return next;
      });

      return ok(present(row));
    },
  },

  DELETE: {
    roles: ['admin'],
    handler: async ({ auth, params }) => {
      requireWriter(auth);
      const target = await loadVisible(params.id ?? '');

      await audited(prisma, async (tx) => {
        // Soft delete AND deactivate: the brief's "(active=false)" and the
        // Deletion law together. The list of active entries a farmer sees drops
        // it on both counts.
        const [row] = await tx.$queryRawUnsafe<{ deleted_at: Date }[]>(
          `UPDATE public.directory_entry
           SET deleted_at = now(), deleted_by = $2::uuid, active = false
           WHERE id = $1::uuid AND deleted_at IS NULL RETURNING deleted_at`,
          target.id,
          auth.principal.id,
        );
        if (!row) throw notFound();
        await writeAudit(tx, {
          entityType: 'directory_entry',
          entityId: target.id,
          actorType: auth.role,
          actorId: auth.principal.id,
          action: 'directory_entry.soft_deleted',
          before: { active: target.active, deleted_at: null },
          after: { active: false, deleted_at: toIso(row.deleted_at) },
        });
      });

      return empty(204);
    },
  },
});
