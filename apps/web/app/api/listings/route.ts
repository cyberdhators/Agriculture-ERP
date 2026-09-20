import { DEFAULT_LIMIT, MAX_LIMIT, decodeCursor, encodeCursor, parseSouthSudanMobile } from '@agri-erp/shared';

import { audited, writeAudit } from '../../../lib/api/audit';
import { ApiFailure, invalidCursor } from '../../../lib/api/errors';
import { created, defineRoutes, paged } from '../../../lib/api/route';
import { prisma } from '../../../lib/db';

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
  status: string;
  created_at: string;
  updated_at: string;
}

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
  status: row.status,
  created_at: row.created_at,
  updated_at: row.updated_at,
});

const presentPublic = (row: ListingRow) => ({
  id: row.id,
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
  created_at: row.created_at,
  updated_at: row.updated_at,
});

const SELECT_COLUMNS = `id, farmer_id, trading_name, title,
  category::text AS category, product_name, description,
  quantity::text AS quantity, unit::text AS unit,
  price_ssp::text AS price_ssp, price_per::text AS price_per,
  negotiable, delivery_available,
  to_char(available_from, 'YYYY-MM-DD') AS available_from,
  CASE WHEN available_until IS NOT NULL
    THEN to_char(available_until, 'YYYY-MM-DD') ELSE NULL END AS available_until,
  harvest_season, pickup_notes, contact_phone,
  status::text AS status,
  created_at::text AS created_at, updated_at::text AS updated_at`;

const VALID_CATEGORIES = [
  'crop', 'vegetable', 'fruit', 'livestock', 'poultry',
  'dairy', 'fish', 'processed', 'seeds_inputs', 'other',
];

const VALID_UNITS = [
  'kg', 'bag_50kg', 'bag_100kg', 'sack', 'crate',
  'bunch', 'piece', 'head', 'litre', 'tin',
];

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export const { GET, POST, PUT, PATCH, DELETE } = defineRoutes({
  GET: {
    roles: 'public',
    handler: async (ctx) => {
      const url = new URL(ctx.request.url);
      const rawLimit = url.searchParams.get('limit');
      const rawCursor = url.searchParams.get('cursor');
      const farmerId = url.searchParams.get('farmer_id');

      let limit = DEFAULT_LIMIT;
      if (rawLimit !== null) {
        const parsed = Number(rawLimit);
        if (!Number.isInteger(parsed) || parsed < 1) throw invalidCursor();
        limit = Math.min(parsed, MAX_LIMIT);
      }

      const where: string[] = ['deleted_at IS NULL'];
      const params: unknown[] = [];

      if (farmerId) {
        params.push(farmerId);
        where.push(`farmer_id = $${params.length}::uuid`);
      } else {
        where.push("status = 'listed'");
      }

      const category = url.searchParams.get('category');
      if (category) {
        params.push(category);
        where.push(`category = $${params.length}::listing_category`);
      }

      const q = url.searchParams.get('q');
      if (q && q.trim().length > 0) {
        params.push(`%${q.trim()}%`);
        where.push(
          `(title ILIKE $${params.length} OR product_name ILIKE $${params.length} OR trading_name ILIKE $${params.length})`,
        );
      }

      if (rawCursor !== null) {
        const cursor = decodeCursor(rawCursor);
        if (!cursor) throw invalidCursor();
        params.push(cursor.createdAt, cursor.id);
        where.push(
          `(updated_at, id) < ($${params.length - 1}::timestamptz, $${params.length}::uuid)`,
        );
      }

      const rows = await prisma.$queryRawUnsafe<ListingRow[]>(
        `SELECT ${SELECT_COLUMNS}
         FROM public.produce_listing
         WHERE ${where.join(' AND ')}
         ORDER BY updated_at DESC, id DESC
         LIMIT ${limit + 1}`,
        ...params,
      );

      const hasMore = rows.length > limit;
      const page = rows.slice(0, limit);
      const last = page[page.length - 1];
      const mapper = farmerId ? present : presentPublic;

      return paged(page.map(mapper), {
        cursor:
          hasMore && last ? encodeCursor({ createdAt: last.updated_at, id: last.id }) : null,
        hasMore,
      });
    },
  },

  POST: {
    roles: 'public',
    handler: async (ctx) => {
      let raw: unknown;
      try {
        raw = await ctx.request.clone().json();
      } catch {
        throw new ApiFailure(400, 'invalid_json', 'The request body is not valid JSON.');
      }
      if (!raw || typeof raw !== 'object') {
        throw new ApiFailure(400, 'invalid_input', 'Expected a JSON object.');
      }
      const input = raw as Record<string, unknown>;

      const farmerId = typeof input.farmer_id === 'string' ? input.farmer_id.trim() : '';
      if (!farmerId) throw new ApiFailure(400, 'invalid_input', 'farmer_id is required.');

      const tradingName = typeof input.trading_name === 'string' ? input.trading_name.trim() : '';
      if (tradingName.length < 2 || tradingName.length > 120) {
        throw new ApiFailure(400, 'invalid_input', 'trading_name must be 2 to 120 characters.');
      }

      const title = typeof input.title === 'string' ? input.title.trim() : '';
      if (title.length < 2 || title.length > 200) {
        throw new ApiFailure(400, 'invalid_input', 'title must be 2 to 200 characters.');
      }

      const category = typeof input.category === 'string' ? input.category : '';
      if (!VALID_CATEGORIES.includes(category)) {
        throw new ApiFailure(400, 'invalid_input', `category must be one of: ${VALID_CATEGORIES.join(', ')}.`);
      }

      const productName = typeof input.product_name === 'string' ? input.product_name.trim() : '';
      if (productName.length < 1 || productName.length > 120) {
        throw new ApiFailure(400, 'invalid_input', 'product_name must be 1 to 120 characters.');
      }

      const description = typeof input.description === 'string' ? input.description.trim() : '';
      if (description.length > 1000) {
        throw new ApiFailure(400, 'invalid_input', 'description must be under 1000 characters.');
      }

      const quantity = typeof input.quantity === 'number' ? input.quantity : NaN;
      if (!Number.isFinite(quantity) || quantity <= 0) {
        throw new ApiFailure(400, 'invalid_input', 'quantity must be a positive number.');
      }

      const unit = typeof input.unit === 'string' ? input.unit : '';
      if (!VALID_UNITS.includes(unit)) {
        throw new ApiFailure(400, 'invalid_input', `unit must be one of: ${VALID_UNITS.join(', ')}.`);
      }

      const priceSsp = typeof input.price_ssp === 'number' ? input.price_ssp : NaN;
      if (!Number.isFinite(priceSsp) || priceSsp < 0) {
        throw new ApiFailure(400, 'invalid_input', 'price_ssp must be a non-negative number.');
      }

      const pricePer = typeof input.price_per === 'string' ? input.price_per : unit;
      if (!VALID_UNITS.includes(pricePer)) {
        throw new ApiFailure(400, 'invalid_input', `price_per must be one of: ${VALID_UNITS.join(', ')}.`);
      }

      const negotiable = input.negotiable === true;
      const deliveryAvailable = input.delivery_available === true;

      const today = new Date().toISOString().slice(0, 10);
      const availableFrom = typeof input.available_from === 'string' && DATE_RE.test(input.available_from)
        ? input.available_from
        : today;

      const availableUntil = typeof input.available_until === 'string' && input.available_until ? input.available_until : null;
      if (availableUntil && !DATE_RE.test(availableUntil)) {
        throw new ApiFailure(400, 'invalid_input', 'available_until must be a date (YYYY-MM-DD).');
      }

      const phoneResult = parseSouthSudanMobile(
        typeof input.contact_phone === 'string' ? input.contact_phone : '',
      );
      if (!phoneResult.ok) {
        throw new ApiFailure(400, 'invalid_input', phoneResult.message);
      }
      const contactPhone = phoneResult.value;

      const harvestSeason = typeof input.harvest_season === 'string' && input.harvest_season.trim() ? input.harvest_season.trim() : null;
      const pickupNotes = typeof input.pickup_notes === 'string' && input.pickup_notes.trim() ? input.pickup_notes.trim() : null;

      const status = typeof input.status === 'string' && ['draft', 'listed'].includes(input.status) ? input.status : 'draft';

      const [farmer] = await prisma.$queryRawUnsafe<{ id: string; payam_id: string; state_id: string }[]>(
        `SELECT id, payam_id, state_id FROM public.farmer WHERE id = $1::uuid AND deleted_at IS NULL LIMIT 1`,
        farmerId,
      );
      if (!farmer) {
        throw new ApiFailure(404, 'not_found', 'Farmer not found.');
      }

      const row = await audited(prisma, async (tx) => {
        const [inserted] = await tx.$queryRawUnsafe<ListingRow[]>(
          `INSERT INTO public.produce_listing
             (farmer_id, trading_name, title, category, product_name, description,
              quantity, unit, price_ssp, price_per, negotiable, delivery_available,
              available_from, available_until, harvest_season, pickup_notes,
              contact_phone, status, payam_id, state_id)
           VALUES ($1::uuid, $2, $3, $4::listing_category, $5, $6,
                   $7, $8::listing_unit, $9, $10::listing_unit, $11, $12,
                   $13::date, $14::date, $15, $16, $17, $18::listing_status,
                   $19, $20)
           RETURNING ${SELECT_COLUMNS}`,
          farmerId, tradingName, title, category, productName, description,
          quantity, unit, priceSsp, pricePer, negotiable, deliveryAvailable,
          availableFrom, availableUntil, harvestSeason, pickupNotes,
          contactPhone, status, farmer.payam_id, farmer.state_id,
        );
        await writeAudit(tx, {
          entityType: 'produce_listing',
          entityId: inserted.id,
          actorType: 'system',
          actorId: null,
          action: 'listing.created',
          after: { title, category, status },
        });
        return inserted;
      });

      return created(present(row));
    },
  },
});
