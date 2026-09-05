import {
  DEFAULT_LIMIT,
  MAX_LIMIT,
  createFarmerSchema,
  decodeCursor,
  encodeCursor,
  farmerFilterSchema,
  toIso,
  zodErrorToApiError,
} from '@agri-erp/shared';
import { randomUUID } from 'node:crypto';
import { audited, writeAudit } from '../../../lib/api/audit';
import {
  ApiFailure,
  conflict,
  forbidden,
  invalidCursor,
  unprocessable,
} from '../../../lib/api/errors';
import {
  FARMER_COLUMNS,
  FARMER_FROM,
  type FarmerRow,
  allocateFarmerNumber,
  auditFields,
  findDuplicates,
  present,
  recordDuplicates,
  rethrowAsConflictIfSameId,
  scopeClause,
} from '../../../lib/api/farmers';
import { createdWith, defineRoutes, paged } from '../../../lib/api/route';
import { requireWriter } from '../../../lib/api/scope';
import { prisma } from '../../../lib/db';

/**
 * C-5: registration (POST) and the scoped list (GET).
 *
 * Nothing in this file writes a sentence. Every refusal is a rule key, and
 * every warning is a list of ids — the standing rule that a farmer's name,
 * phone or national ID never appears in a message is structural here.
 */
export const { GET, POST, PUT, PATCH, DELETE } = defineRoutes({
  GET: {
    roles: ['admin', 'supervisor', 'read_only', 'officer'],
    handler: async ({ request, auth }) => {
      const url = new URL(request.url);
      const parsed = farmerFilterSchema.safeParse(Object.fromEntries(url.searchParams));
      if (!parsed.success) {
        const { body } = zodErrorToApiError(parsed.error);
        throw new ApiFailure(400, body.error.code, body.error.message, body.error.fields);
      }
      const filter = parsed.data;

      let limit = DEFAULT_LIMIT;
      if (filter.limit !== undefined) {
        const n = Number(filter.limit);
        if (!Number.isInteger(n) || n < 1) throw invalidCursor();
        limit = Math.min(n, MAX_LIMIT);
      }

      const params: unknown[] = [];
      const where: string[] = scopeClause(auth, params);
      const add = (sql: (i: number) => string, value: unknown) => {
        params.push(value);
        where.push(sql(params.length));
      };
      if (filter.verification_status) {
        add(
          (i) => `f.verification_status = $${i}::public.verification_status`,
          filter.verification_status,
        );
      }
      if (filter.payam) add((i) => `f.payam_id = $${i}`, filter.payam);
      if (filter.county) add((i) => `f.county_id = $${i}`, filter.county);
      if (filter.sex) add((i) => `f.sex = $${i}::public.sex`, filter.sex);
      if (filter.registered_from)
        add((i) => `f.created_at >= $${i}::timestamptz`, filter.registered_from);
      if (filter.registered_to)
        add((i) => `f.created_at <= $${i}::timestamptz`, filter.registered_to);
      if (filter.duplicate_flag)
        add((i) => `f.duplicate_flag = $${i}`, filter.duplicate_flag === 'true');
      if (filter.cursor !== undefined) {
        const cursor = decodeCursor(filter.cursor);
        if (!cursor) throw invalidCursor();
        params.push(cursor.createdAt, cursor.id);
        where.push(
          `(f.created_at, f.id) < ($${params.length - 1}::timestamptz, $${params.length}::uuid)`,
        );
      }

      const rows = await prisma.$queryRawUnsafe<FarmerRow[]>(
        `SELECT ${FARMER_COLUMNS} ${FARMER_FROM}
         ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
         ORDER BY f.created_at DESC, f.id DESC
         LIMIT ${limit + 1}`,
        ...params,
      );
      const hasMore = rows.length > limit;
      const page = rows.slice(0, limit);
      const last = page[page.length - 1];
      return paged(
        page.map((row) => present(row, auth)),
        {
          cursor:
            hasMore && last
              ? encodeCursor({ createdAt: toIso(last.created_at), id: last.id })
              : null,
          hasMore,
        },
      );
    },
  },

  POST: {
    roles: ['admin', 'officer'],
    bodySchema: createFarmerSchema,
    handler: async ({ auth, body }) => {
      requireWriter(auth);

      // C-5.1: an officer registers in their own payam, as themselves.
      let registeredBy: string;
      if (auth.role === 'officer') {
        if (auth.scope.kind !== 'caseload' || body.payam_id !== auth.scope.payamId)
          throw forbidden();
        if (body.registered_by !== undefined && body.registered_by !== auth.principal.id) {
          throw forbidden();
        }
        registeredBy = auth.principal.id;
      } else {
        if (!body.registered_by) throw unprocessable('registering_officer_required');
        registeredBy = body.registered_by;
      }

      const [payam] = await prisma.$queryRawUnsafe<
        { id: string; county_id: string; state_id: string }[]
      >('SELECT id, county_id, state_id FROM public.payam_active WHERE id = $1', body.payam_id);
      if (!payam) throw unprocessable('payam_not_found');

      const [officer] = await prisma.$queryRawUnsafe<{ id: string }[]>(
        'SELECT id FROM public.officer_active WHERE id = $1::uuid AND payam_id = $2',
        registeredBy,
        payam.id,
      );
      if (!officer) throw unprocessable('registering_officer_not_found');

      // C-5.3: valid input, rule not met — 422, not 400.
      if (!body.consent || body.consent.granted !== true) throw unprocessable('consent_required');

      const [existing] = await prisma.$queryRawUnsafe<{ id: string }[]>(
        'SELECT id FROM public.farmer WHERE id = $1::uuid',
        body.id,
      );
      if (existing) throw conflict('farmer_already_exists');

      const consentId = randomUUID();
      let matches: string[] = [];
      const row = await audited(prisma, async (tx) => {
        const farmerNumber = await allocateFarmerNumber(tx, payam.county_id);
        try {
          await tx.$executeRawUnsafe(
            `INSERT INTO public.farmer
               (id, farmer_number, given_name, family_name, sex, year_of_birth, phone, national_id,
                payam_id, county_id, state_id, registered_by, registration_source, consent_id)
             VALUES ($1::uuid, $2, $3, $4, $5::public.sex, $6, $7, $8, $9, $10, $11, $12::uuid,
                     'officer', $13::uuid)`,
            body.id,
            farmerNumber,
            body.given_name,
            body.family_name,
            body.sex,
            body.year_of_birth,
            body.phone,
            body.national_id ?? null,
            payam.id,
            payam.county_id,
            payam.state_id,
            registeredBy,
            consentId,
          );
        } catch (failure) {
          rethrowAsConflictIfSameId(failure);
        }
        await tx.$executeRawUnsafe(
          `INSERT INTO public.consent (id, farmer_id, text_version, language, granted)
           VALUES ($1::uuid, $2::uuid, $3, $4::public.language, true)`,
          consentId,
          body.id,
          body.consent!.text_version,
          body.consent!.language,
        );

        matches = await findDuplicates(tx, {
          id: body.id,
          phone: body.phone,
          given_name: body.given_name,
          family_name: body.family_name,
          payam_id: payam.id,
        });
        if (matches.length > 0) await recordDuplicates(tx, body.id, matches);

        const [inserted] = await tx.$queryRawUnsafe<FarmerRow[]>(
          `SELECT ${FARMER_COLUMNS} ${FARMER_FROM} WHERE f.id = $1::uuid`,
          body.id,
        );
        const created_ = inserted as FarmerRow;
        const actor = { actorType: auth.role, actorId: auth.principal.id } as const;
        await writeAudit(tx, {
          entityType: 'farmer',
          entityId: created_.id,
          ...actor,
          action: 'farmer.created',
          after: auditFields(created_),
        });
        await writeAudit(tx, {
          entityType: 'consent',
          entityId: consentId,
          ...actor,
          action: 'consent.recorded',
          after: {
            farmer_id: created_.id,
            text_version: created_.consent_text_version,
            language: created_.consent_language,
            granted: true,
          },
        });
        return created_;
      });

      return createdWith(present(row, auth), { duplicates: matches });
    },
  },
});
