import { type RecordFarm, recordFarmSchema } from '@agri-erp/shared';
import { audited, writeAudit } from '../../../../../../lib/api/audit';
import { conflict, forbidden } from '../../../../../../lib/api/errors';
import { inCaseloadOf, loadVisible, sameInstant } from '../../../../../../lib/api/farmers';
import {
  FARM_COLUMNS,
  FARM_FROM,
  type FarmRow,
  cropsOf,
  presentFarm,
} from '../../../../../../lib/api/farms';
import { created, defineRoutes, ok } from '../../../../../../lib/api/route';
import { requireWriter } from '../../../../../../lib/api/scope';
import { prisma } from '../../../../../../lib/db';

/**
 * POST /api/farmers/:id/farms/manual — an officer with the farmer in their
 * caseload records a farm by hand (2026-10-10): its name, the size the farmer
 * declared, tenure, village, directions, optionally the phone's position at
 * the farm, the season's crops, notes. No boundary: the farm is mapped later
 * with POST /api/farms/:id/boundaries, and only that counts as mapped area.
 *
 * C-9.2: a retry of a record that landed is 200 with the farm; the same id
 * carrying different details is a conflict.
 */
export const { GET, POST, PUT, PATCH, DELETE } = defineRoutes({
  POST: {
    roles: ['officer'],
    bodySchema: recordFarmSchema,
    handler: async ({ auth, body, params }) => {
      requireWriter(auth);
      // Caseload scope: a farmer outside it is a 404 (C-7.6).
      const farmer = await loadVisible(prisma, params.id ?? '', auth);
      if (!inCaseloadOf(auth, farmer)) throw forbidden();

      const [existing] = await prisma.$queryRawUnsafe<FarmRow[]>(
        `SELECT ${FARM_COLUMNS} ${FARM_FROM} WHERE f.id = $1::uuid`,
        body.id,
      );
      if (existing) {
        const crops = await cropsOf(prisma, [existing.id]);
        if (existing.farmer_id === farmer.id && sameRecord(body, existing, crops)) {
          return ok(presentFarm(existing, [], crops, auth));
        }
        throw conflict('farm_already_exists');
      }
      const [anyRow] = await prisma.$queryRawUnsafe<{ id: string }[]>(
        'SELECT id FROM public.farm WHERE id = $1::uuid',
        body.id,
      );
      if (anyRow) throw conflict('farm_already_exists');

      const result = await audited(prisma, async (tx) => {
        const point = body.location ?? null;
        await tx.$executeRawUnsafe(
          `INSERT INTO public.farm (id, farmer_id, payam_id, county_id, state_id, season, created_by,
             captured_at, name, size_value, size_unit, tenure, village, location_note, notes,
             location, location_accuracy_m)
           VALUES ($1::uuid, $2::uuid, $3, $4, $5, $6, $7::uuid, $8::timestamptz, $9, $10::numeric,
             $11, $12, $13, $14, $15,
             CASE WHEN $16::float8 IS NULL THEN NULL
                  ELSE extensions.ST_SetSRID(extensions.ST_MakePoint($17::float8, $16::float8), 4326)::extensions.geography
             END,
             $18::numeric)`,
          body.id,
          farmer.id,
          farmer.payam_id,
          farmer.county_id,
          farmer.state_id,
          body.season,
          auth.principal.id,
          body.captured_at ?? null,
          body.name ?? null,
          body.size_value ?? null,
          body.size_unit ?? null,
          body.tenure ?? null,
          body.village ?? null,
          body.location_note ?? null,
          body.notes ?? null,
          point?.latitude ?? null,
          point?.longitude ?? null,
          point?.accuracy_m ?? null,
        );
        for (const crop of body.crops) {
          await tx.$executeRawUnsafe(
            `INSERT INTO public.crop_declaration (farm_id, season, crop, declared_by)
             VALUES ($1::uuid, $2, $3::public.crop, $4::uuid)`,
            body.id,
            body.season,
            crop,
            auth.principal.id,
          );
        }
        const actor = { actorType: auth.role, actorId: auth.principal.id } as const;
        await writeAudit(tx, {
          entityType: 'farm',
          entityId: body.id,
          ...actor,
          action: 'farm.created',
          after: {
            farmer_id: farmer.id,
            payam_id: farmer.payam_id,
            county_id: farmer.county_id,
            state_id: farmer.state_id,
            season: body.season,
            recorded: 'by_hand',
            name: body.name ?? null,
            size: body.size_value != null ? { value: body.size_value, unit: body.size_unit } : null,
            tenure: body.tenure ?? null,
            village: body.village ?? null,
            has_location: point !== null,
          },
        });
        if (body.crops.length > 0) {
          await writeAudit(tx, {
            entityType: 'farm',
            entityId: body.id,
            ...actor,
            action: 'farm.crops_declared',
            before: { season: body.season, crops: [] },
            after: { season: body.season, crops: [...body.crops].sort() },
          });
        }
        const [farm] = await tx.$queryRawUnsafe<FarmRow[]>(
          `SELECT ${FARM_COLUMNS} ${FARM_FROM} WHERE f.id = $1::uuid`,
          body.id,
        );
        return farm as FarmRow;
      });
      const crops = await cropsOf(prisma, [result.id]);
      return created(presentFarm(result, [], crops, auth));
    },
  },
});

/** The stored farm is this request, sent again. */
function sameRecord(
  body: RecordFarm,
  row: FarmRow,
  crops: readonly { season: string; crop: string }[],
): boolean {
  const num = (v: unknown) => (v === null || v === undefined ? null : Number(v));
  // The columns round: the size to 2 places, the accuracy to 1.
  const close = (a: number | null, b: number | null, places = 9) =>
    a === null || b === null ? a === b : Math.abs(a - b) < 10 ** -places / 2 + 1e-9;
  const point = row.location_geojson
    ? (JSON.parse(row.location_geojson) as { coordinates: [number, number] }).coordinates
    : null;
  const declared = crops
    .filter((c) => c.season === body.season)
    .map((c) => c.crop)
    .sort();
  return (
    row.season === body.season &&
    sameInstant(body.captured_at, row.captured_at) &&
    row.name === (body.name ?? null) &&
    close(num(row.size_value), num(body.size_value), 2) &&
    row.size_unit === (body.size_unit ?? null) &&
    row.tenure === (body.tenure ?? null) &&
    row.village === (body.village ?? null) &&
    row.location_note === (body.location_note ?? null) &&
    row.notes === (body.notes ?? null) &&
    close(point ? point[1] : null, body.location?.latitude ?? null) &&
    close(point ? point[0] : null, body.location?.longitude ?? null) &&
    close(num(row.location_accuracy_m), body.location?.accuracy_m ?? null, 1) &&
    JSON.stringify(declared) === JSON.stringify([...body.crops].sort())
  );
}
