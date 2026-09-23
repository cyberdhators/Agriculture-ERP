import { parseSouthSudanMobile } from '@agri-erp/shared';

import { audited, writeAudit } from '../../../../lib/api/audit';
import { ApiFailure, notFound } from '../../../../lib/api/errors';
import { defineRoutes, ok } from '../../../../lib/api/route';
import { prisma } from '../../../../lib/db';

interface ListingRow {
  id: string;
  farmer_id: string;
  trading_name: string;
  title: string;
  category: string;
  product_name: string;
  description: string;
  quantity: string;
  unit: string;
  price_ssp: string;
  price_per: string;
  negotiable: boolean;
  delivery_available: boolean;
  available_from: string;
  available_until: string | null;
  harvest_season: string | null;
  pickup_notes: string | null;
  contact_phone: string;
  photo_storage_paths: string[];
  status: string;
  created_at: string;
  updated_at: string;
}

interface BrowseRow extends ListingRow {
  seller_verification_status: string;
  seller_payam_id: string;
  seller_payam_name: string;
  seller_created_at: string;
}

const RETURNING_COLUMNS = `id, farmer_id, trading_name, title,
  category::text AS category, product_name, description,
  quantity::text AS quantity, unit::text AS unit,
  price_ssp::text AS price_ssp, price_per::text AS price_per,
  negotiable, delivery_available,
  to_char(available_from, 'YYYY-MM-DD') AS available_from,
  CASE WHEN available_until IS NOT NULL
    THEN to_char(available_until, 'YYYY-MM-DD') ELSE NULL END AS available_until,
  harvest_season, pickup_notes, contact_phone, photo_storage_paths,
  status::text AS status,
  created_at::text AS created_at, updated_at::text AS updated_at`;

const BROWSE_COLUMNS = `pl.id, pl.farmer_id, pl.trading_name, pl.title,
  pl.category::text AS category, pl.product_name, pl.description,
  pl.quantity::text AS quantity, pl.unit::text AS unit,
  pl.price_ssp::text AS price_ssp, pl.price_per::text AS price_per,
  pl.negotiable, pl.delivery_available,
  to_char(pl.available_from, 'YYYY-MM-DD') AS available_from,
  CASE WHEN pl.available_until IS NOT NULL
    THEN to_char(pl.available_until, 'YYYY-MM-DD') ELSE NULL END AS available_until,
  pl.harvest_season, pl.pickup_notes, pl.contact_phone, pl.photo_storage_paths,
  pl.status::text AS status,
  pl.created_at::text AS created_at, pl.updated_at::text AS updated_at,
  f.verification_status::text AS seller_verification_status,
  f.payam_id AS seller_payam_id,
  pm.name AS seller_payam_name,
  f.created_at::text AS seller_created_at`;

const present = (row: ListingRow) => ({
  id: row.id,
  farmer_id: row.farmer_id,
  trading_name: row.trading_name,
  title: row.title,
  category: row.category,
  product_name: row.product_name,
  description: row.description,
  quantity: Number(row.quantity),
  unit: row.unit,
  price_ssp: Number(row.price_ssp),
  price_per: row.price_per,
  negotiable: row.negotiable,
  delivery_available: row.delivery_available,
  available_from: row.available_from,
  available_until: row.available_until,
  harvest_season: row.harvest_season,
  pickup_notes: row.pickup_notes,
  contact_phone: row.contact_phone,
  photo_storage_paths: row.photo_storage_paths,
  status: row.status,
  created_at: row.created_at,
  updated_at: row.updated_at,
});

const presentBrowse = (row: BrowseRow) => ({
  id: row.id,
  farmer_id: row.farmer_id,
  trading_name: row.trading_name,
  title: row.title,
  category: row.category,
  product_name: row.product_name,
  description: row.description,
  quantity: Number(row.quantity),
  unit: row.unit,
  price_ssp: Number(row.price_ssp),
  price_per: row.price_per,
  negotiable: row.negotiable,
  delivery_available: row.delivery_available,
  available_from: row.available_from,
  available_until: row.available_until,
  harvest_season: row.harvest_season,
  pickup_notes: row.pickup_notes,
  photo_storage_paths: row.photo_storage_paths,
  status: row.status,
  created_at: row.created_at,
  updated_at: row.updated_at,
  seller_verification_status: row.seller_verification_status,
  seller_payam_id: row.seller_payam_id,
  seller_payam_name: row.seller_payam_name,
  seller_created_at: row.seller_created_at,
});

const VALID_CATEGORIES = [
  'crop',
  'vegetable',
  'fruit',
  'livestock',
  'poultry',
  'dairy',
  'fish',
  'processed',
  'seeds_inputs',
  'other',
];

const VALID_UNITS = [
  'kg',
  'bag_50kg',
  'bag_100kg',
  'sack',
  'crate',
  'bunch',
  'piece',
  'head',
  'litre',
  'tin',
];

const VALID_STATUSES = ['draft', 'listed', 'withdrawn', 'sold'];
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export const { GET, POST, PUT, PATCH, DELETE } = defineRoutes({
  GET: {
    roles: 'public',
    handler: async (ctx) => {
      const { id } = ctx.params;
      const [row] = await prisma.$queryRawUnsafe<BrowseRow[]>(
        `SELECT ${BROWSE_COLUMNS}
         FROM public.produce_listing pl
         JOIN public.farmer f ON f.id = pl.farmer_id AND f.deleted_at IS NULL
         JOIN public.payam pm ON pm.id = f.payam_id
         WHERE pl.id = $1::uuid AND pl.deleted_at IS NULL
         LIMIT 1`,
        id,
      );
      if (!row) throw notFound();
      return ok(presentBrowse(row));
    },
  },

  PATCH: {
    roles: 'public',
    handler: async (ctx) => {
      const id = ctx.params.id as string;

      let raw: unknown;
      try {
        raw = await ctx.request.json();
      } catch {
        throw new ApiFailure(400, 'invalid_json', 'The request body is not valid JSON.');
      }
      if (!raw || typeof raw !== 'object') {
        throw new ApiFailure(400, 'invalid_input', 'Expected a JSON object.');
      }
      const input = raw as Record<string, unknown>;

      const farmerId = typeof input.farmer_id === 'string' ? input.farmer_id.trim() : '';
      if (!farmerId) throw new ApiFailure(400, 'invalid_input', 'farmer_id is required.');

      const [existing] = await prisma.$queryRawUnsafe<ListingRow[]>(
        `SELECT ${RETURNING_COLUMNS}
         FROM public.produce_listing
         WHERE id = $1::uuid AND farmer_id = $2::uuid AND deleted_at IS NULL
         LIMIT 1`,
        id,
        farmerId,
      );
      if (!existing) throw notFound();

      const sets: string[] = ['updated_at = now()'];
      const params: unknown[] = [id];
      let paramIdx = 2;

      const tryString = (key: string, min: number, max: number) => {
        if (key in input) {
          const val = typeof input[key] === 'string' ? input[key].trim() : '';
          if (val.length < min || val.length > max) {
            throw new ApiFailure(
              400,
              'invalid_input',
              `${key} must be ${min} to ${max} characters.`,
            );
          }
          sets.push(`${key} = $${paramIdx}`);
          params.push(val);
          paramIdx++;
        }
      };

      tryString('trading_name', 2, 120);
      tryString('title', 2, 200);
      tryString('product_name', 1, 120);
      tryString('description', 0, 1000);

      if ('category' in input) {
        const cat = input.category as string;
        if (!VALID_CATEGORIES.includes(cat)) {
          throw new ApiFailure(
            400,
            'invalid_input',
            `category must be one of: ${VALID_CATEGORIES.join(', ')}.`,
          );
        }
        sets.push(`category = $${paramIdx}::listing_category`);
        params.push(cat);
        paramIdx++;
      }

      if ('quantity' in input) {
        const qty = typeof input.quantity === 'number' ? input.quantity : NaN;
        if (!Number.isFinite(qty) || qty <= 0) {
          throw new ApiFailure(400, 'invalid_input', 'quantity must be a positive number.');
        }
        sets.push(`quantity = $${paramIdx}`);
        params.push(qty);
        paramIdx++;
      }

      if ('unit' in input) {
        const u = input.unit as string;
        if (!VALID_UNITS.includes(u)) {
          throw new ApiFailure(
            400,
            'invalid_input',
            `unit must be one of: ${VALID_UNITS.join(', ')}.`,
          );
        }
        sets.push(`unit = $${paramIdx}::listing_unit`);
        params.push(u);
        paramIdx++;
      }

      if ('price_ssp' in input) {
        const p = typeof input.price_ssp === 'number' ? input.price_ssp : NaN;
        if (!Number.isFinite(p) || p < 0) {
          throw new ApiFailure(400, 'invalid_input', 'price_ssp must be a non-negative number.');
        }
        sets.push(`price_ssp = $${paramIdx}`);
        params.push(p);
        paramIdx++;
      }

      if ('price_per' in input) {
        const pp = input.price_per as string;
        if (!VALID_UNITS.includes(pp)) {
          throw new ApiFailure(
            400,
            'invalid_input',
            `price_per must be one of: ${VALID_UNITS.join(', ')}.`,
          );
        }
        sets.push(`price_per = $${paramIdx}::listing_unit`);
        params.push(pp);
        paramIdx++;
      }

      if ('negotiable' in input) {
        sets.push(`negotiable = $${paramIdx}`);
        params.push(input.negotiable === true);
        paramIdx++;
      }

      if ('delivery_available' in input) {
        sets.push(`delivery_available = $${paramIdx}`);
        params.push(input.delivery_available === true);
        paramIdx++;
      }

      if ('available_from' in input) {
        const af = input.available_from as string;
        if (!DATE_RE.test(af)) {
          throw new ApiFailure(400, 'invalid_input', 'available_from must be a date (YYYY-MM-DD).');
        }
        sets.push(`available_from = $${paramIdx}::date`);
        params.push(af);
        paramIdx++;
      }

      if ('available_until' in input) {
        const au = input.available_until;
        if (au === null) {
          sets.push(`available_until = NULL`);
        } else if (typeof au === 'string' && DATE_RE.test(au)) {
          sets.push(`available_until = $${paramIdx}::date`);
          params.push(au);
          paramIdx++;
        } else {
          throw new ApiFailure(400, 'invalid_input', 'available_until must be a date or null.');
        }
      }

      if ('harvest_season' in input) {
        const hs =
          typeof input.harvest_season === 'string' && input.harvest_season.trim()
            ? input.harvest_season.trim()
            : null;
        sets.push(`harvest_season = $${paramIdx}`);
        params.push(hs);
        paramIdx++;
      }

      if ('pickup_notes' in input) {
        const pn =
          typeof input.pickup_notes === 'string' && input.pickup_notes.trim()
            ? input.pickup_notes.trim()
            : null;
        sets.push(`pickup_notes = $${paramIdx}`);
        params.push(pn);
        paramIdx++;
      }

      if ('contact_phone' in input) {
        const phoneResult = parseSouthSudanMobile(
          typeof input.contact_phone === 'string' ? input.contact_phone : '',
        );
        if (!phoneResult.ok) {
          throw new ApiFailure(400, 'invalid_input', phoneResult.message);
        }
        sets.push(`contact_phone = $${paramIdx}`);
        params.push(phoneResult.value);
        paramIdx++;
      }

      let statusChanged = false;
      if ('status' in input) {
        const s = input.status as string;
        if (!VALID_STATUSES.includes(s)) {
          throw new ApiFailure(
            400,
            'invalid_input',
            `status must be one of: ${VALID_STATUSES.join(', ')}.`,
          );
        }
        sets.push(`status = $${paramIdx}::listing_status`);
        params.push(s);
        paramIdx++;
        statusChanged = s !== existing.status;
      }

      const row = await audited(prisma, async (tx) => {
        const rows = await tx.$queryRawUnsafe<ListingRow[]>(
          `UPDATE public.produce_listing
           SET ${sets.join(', ')}
           WHERE id = $1::uuid AND deleted_at IS NULL
           RETURNING ${RETURNING_COLUMNS}`,
          ...params,
        );
        const updated = rows[0]!;

        const action = statusChanged ? 'listing.status_changed' : 'listing.updated';
        await writeAudit(tx, {
          entityType: 'produce_listing',
          entityId: id,
          actorType: 'system',
          actorId: null,
          action,
          before: statusChanged ? { status: existing.status } : undefined,
          after: statusChanged ? { status: input.status as string } : { title: updated.title },
        });

        return updated;
      });

      return ok(present(row));
    },
  },
});
