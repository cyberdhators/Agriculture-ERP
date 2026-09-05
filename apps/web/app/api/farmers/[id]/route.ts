import { patchFarmerSchema, toIso } from '@agri-erp/shared';
import { audited, writeAudit } from '../../../../lib/api/audit';
import { forbidden, notFound, unprocessable } from '../../../../lib/api/errors';
import {
  FARMER_COLUMNS,
  FARMER_FROM,
  type FarmerRow,
  auditFields,
  findDuplicates,
  loadVisible,
  present,
  recordDuplicates,
} from '../../../../lib/api/farmers';
import { defineRoutes, empty, ok, okWith } from '../../../../lib/api/route';
import { requireWriter } from '../../../../lib/api/scope';
import { prisma } from '../../../../lib/db';

/**
 * C-5: one farmer — read, change, remove.
 *
 * Scope first, always: a farmer outside the caller's scope is a 404 before any
 * permission is considered (C-5.7), so an officer learns nothing about
 * another officer's caseload from the shape of a refusal.
 */
export const { GET, POST, PUT, PATCH, DELETE } = defineRoutes({
  GET: {
    roles: ['admin', 'supervisor', 'read_only', 'officer'],
    handler: async ({ auth, params }) =>
      ok(present(await loadVisible(prisma, params.id ?? '', auth), auth)),
  },

  PATCH: {
    roles: ['admin', 'officer'],
    bodySchema: patchFarmerSchema,
    handler: async ({ auth, body, params }) => {
      requireWriter(auth);
      // Not theirs → 404 (scope). Theirs but no longer pending → 403 (C-5.9).
      const target = await loadVisible(prisma, params.id ?? '', auth);
      if (auth.role === 'officer') {
        if (target.verification_status !== 'pending') throw forbidden();
        if (
          body.payam_id !== undefined &&
          (auth.scope.kind !== 'caseload' || body.payam_id !== auth.scope.payamId)
        ) {
          throw forbidden();
        }
      }

      let payamId = target.payam_id;
      let countyId = target.county_id;
      let stateId = target.state_id;
      if (body.payam_id !== undefined && body.payam_id !== target.payam_id) {
        const [payam] = await prisma.$queryRawUnsafe<
          { id: string; county_id: string; state_id: string }[]
        >('SELECT id, county_id, state_id FROM public.payam_active WHERE id = $1', body.payam_id);
        if (!payam) throw unprocessable('payam_not_found');
        payamId = payam.id;
        countyId = payam.county_id;
        stateId = payam.state_id;
      }

      const next = {
        given_name: body.given_name ?? target.given_name,
        family_name: body.family_name ?? target.family_name,
        sex: body.sex ?? target.sex,
        year_of_birth: body.year_of_birth ?? target.year_of_birth,
        phone: body.phone ?? target.phone,
        national_id: body.national_id === undefined ? target.national_id : body.national_id,
      };
      const identityChanged =
        next.phone !== target.phone ||
        next.given_name !== target.given_name ||
        next.family_name !== target.family_name ||
        payamId !== target.payam_id;

      let matches: string[] = target.duplicate_matches;
      const row = await audited(prisma, async (tx) => {
        const updated = await tx.$executeRawUnsafe(
          `UPDATE public.farmer
           SET given_name = $2, family_name = $3, sex = $4::public.sex, year_of_birth = $5,
               phone = $6, national_id = $7, payam_id = $8, county_id = $9, state_id = $10
           WHERE id = $1::uuid AND deleted_at IS NULL`,
          target.id,
          next.given_name,
          next.family_name,
          next.sex,
          next.year_of_birth,
          next.phone,
          next.national_id,
          payamId,
          countyId,
          stateId,
        );
        if (updated !== 1) throw notFound();

        if (identityChanged) {
          matches = await findDuplicates(tx, {
            id: target.id,
            phone: next.phone,
            given_name: next.given_name,
            family_name: next.family_name,
            payam_id: payamId,
          });
          await recordDuplicates(tx, target.id, matches);
        }

        const [after] = await tx.$queryRawUnsafe<FarmerRow[]>(
          `SELECT ${FARMER_COLUMNS} ${FARMER_FROM} WHERE f.id = $1::uuid`,
          target.id,
        );
        const fresh = after as FarmerRow;

        // Changed fields only. Names, phone and national id are stripped by
        // auditSafe before the row is written (C-4.7); the keys below are the
        // ones that survive, plus the personal ones so the strip is exercised
        // rather than assumed.
        const before: Record<string, unknown> = {};
        const changed: Record<string, unknown> = {};
        const compare = (key: string, was: unknown, now: unknown) => {
          if (JSON.stringify(was) !== JSON.stringify(now)) {
            before[key] = was;
            changed[key] = now;
          }
        };
        const wasFields = auditFields(target);
        const nowFields = auditFields(fresh);
        for (const key of Object.keys(nowFields)) compare(key, wasFields[key], nowFields[key]);
        compare('given_name', target.given_name, fresh.given_name);
        compare('family_name', target.family_name, fresh.family_name);
        compare('phone', target.phone, fresh.phone);
        compare('national_id', target.national_id, fresh.national_id);
        if (Object.keys(changed).length > 0) {
          await writeAudit(tx, {
            entityType: 'farmer',
            entityId: fresh.id,
            actorType: auth.role,
            actorId: auth.principal.id,
            action: 'farmer.updated',
            before,
            after: changed,
          });
        }
        return fresh;
      });

      return okWith(present(row, auth), { duplicates: identityChanged ? matches : [] });
    },
  },

  DELETE: {
    roles: ['admin'],
    handler: async ({ auth, params }) => {
      requireWriter(auth);
      const target = await loadVisible(prisma, params.id ?? '', auth);
      await audited(prisma, async (tx) => {
        const [row] = await tx.$queryRawUnsafe<{ deleted_at: Date }[]>(
          `UPDATE public.farmer SET deleted_at = now(), deleted_by = $2::uuid
           WHERE id = $1::uuid AND deleted_at IS NULL RETURNING deleted_at`,
          target.id,
          auth.principal.id,
        );
        if (!row) throw notFound();
        await writeAudit(tx, {
          entityType: 'farmer',
          entityId: target.id,
          actorType: auth.role,
          actorId: auth.principal.id,
          action: 'farmer.soft_deleted',
          before: { deleted_at: null },
          after: { deleted_at: toIso(row.deleted_at), farmer_number: target.farmer_number },
        });
      });
      return empty(204);
    },
  },
});
