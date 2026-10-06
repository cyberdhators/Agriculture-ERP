// pnpm buyers:seed -- B13 DEMONSTRATION DATA, STAGING ONLY.
//
// Three buyer organisations, six produce listings, purchase requests in
// several states, three orders with delivery histories, and notifications:
// enough to click through every buyer screen and both administrator screens.
//
// EVERY ROW IS INVENTED AND SAYS SO. Organisation names begin "Demo", people
// are "Placeholder", emails are @example.invalid (RFC 2606: undeliverable by
// design), phones are in the +254700000xxx and +21191000xxxx blocks the other
// seeds use for invented numbers. Nothing resembles a real person or company.
// Every audit row carries `seed: 'demo'`. Fixed ids make it idempotent: a
// second run skips what exists.
//
// IT REFUSES TO RUN unless both connection strings positively identify the
// staging project -- the same rule as db-reset.mjs, because demonstration
// data in production is exactly the record CLAUDE.md forbids ("real farmer
// data exists in production only"). The project reference below is the third
// copy of that name in the repository; #108's closed allowlist
// (scripts/non-production-projects.mjs) replaces the other two and should
// replace this one when it lands -- its tree-walking gate will name this file.
//
// Requires: the placeholder farmers (pnpm farmers:seed), one non-test
// administrator account, and BUYER_DEMO_PASSWORD -- the password the three
// demonstration buyers sign in with. No default: a password in code is a
// committed credential (CLAUDE.md, Secrets).

import { PrismaClient } from '@prisma/client';

import { seedFarmerId } from './farmers-seed-lib.mjs';
import { makePrisma } from './locations-lib.mjs';

const STAGING_PROJECT_REF = 'xmmxbrxmfgodhpwolrvk';

function refuse(...lines) {
  console.error(['', 'buyers:seed REFUSED.', ...lines, ''].join('\n'));
  process.exit(1);
}

for (const name of ['NEXT_PUBLIC_SUPABASE_URL', 'DATABASE_URL']) {
  if (!String(process.env[name] ?? '').includes(STAGING_PROJECT_REF)) {
    refuse(
      `${name} does not identify the staging project.`,
      'Demonstration data goes to staging or nowhere.',
    );
  }
}
const password = process.env.BUYER_DEMO_PASSWORD ?? '';
if (password.length < 12) {
  refuse(
    'Set BUYER_DEMO_PASSWORD (12 characters or more) in .env.local.',
    'It is the password the demonstration buyers sign in with.',
  );
}
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!serviceKey)
  refuse('SUPABASE_SERVICE_ROLE_KEY must be set to create the demonstration sign-in accounts.');

const id = (block, n) => `00000000-0000-4000-8000-0000${block}${String(n).padStart(7, '0')}`;
const orgId = (n) => id('06', n);
const buyerId = (n) => id('07', n);
const listingId = (n) => id('08', n);
const requestId = (n) => id('09', n);
const orderId = (n) => id('10', n);

const ORGS = [
  {
    n: 1,
    name: 'Demo Placeholder Grain Traders',
    type: 'trader',
    status: 'verified',
    country: 'SS',
    city: 'Juba',
    categories: ['crop'],
    products: ['Maize', 'Sorghum'],
  },
  {
    n: 2,
    name: 'Demo Placeholder Oilseed Processors',
    type: 'processor',
    status: 'under_review',
    country: 'SS',
    city: 'Juba',
    categories: ['crop'],
    products: ['Sesame', 'Groundnut'],
  },
  {
    n: 3,
    name: 'Demo Placeholder Relief Procurement',
    type: 'ngo',
    status: 'pending',
    country: 'KE',
    city: 'Nairobi',
    categories: ['crop', 'vegetable'],
    products: ['Cowpea', 'Sorghum'],
  },
  // An individual buyer: no review, standing `not_required`, never "verified".
  {
    n: 4,
    name: 'Placeholder Buyer 4',
    type: 'other',
    status: 'not_required',
    account: 'individual',
    country: 'SS',
    city: 'Juba',
    categories: ['vegetable'],
    products: ['Okra'],
  },
];

const LISTINGS = [
  {
    n: 1,
    farmer: 1,
    product: 'Maize',
    category: 'crop',
    qty: 4000,
    unit: 'kg',
    price: 850,
    grade: 'a',
    moq: 500,
  },
  {
    n: 2,
    farmer: 2,
    product: 'Sorghum',
    category: 'crop',
    qty: 120,
    unit: 'bag_50kg',
    price: 32000,
    grade: 'b',
    moq: 10,
  },
  {
    n: 3,
    farmer: 3,
    product: 'Sesame',
    category: 'crop',
    qty: 1500,
    unit: 'kg',
    price: 2100,
    grade: 'a',
    moq: 200,
  },
  {
    n: 4,
    farmer: 4,
    product: 'Groundnut',
    category: 'crop',
    qty: 900,
    unit: 'kg',
    price: 1600,
    grade: 'ungraded',
    moq: null,
  },
  {
    n: 5,
    farmer: 5,
    product: 'Cowpea',
    category: 'crop',
    qty: 60,
    unit: 'bag_50kg',
    price: 41000,
    grade: 'b',
    moq: 5,
  },
  {
    n: 6,
    farmer: 6,
    product: 'Okra',
    category: 'vegetable',
    qty: 300,
    unit: 'kg',
    price: 1200,
    grade: 'c',
    moq: null,
  },
];

async function createAuthAccount(email) {
  const base = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const headers = {
    apikey: serviceKey,
    Authorization: `Bearer ${serviceKey}`,
    'Content-Type': 'application/json',
  };
  const response = await globalThis.fetch(`${base}/auth/v1/admin/users`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ email, password, email_confirm: true }),
  });
  const body = await response.json().catch(() => ({}));
  if (response.status < 300) return body.id;
  throw new Error(`Could not create the sign-in account for ${email}: ${response.status}`);
}

const prisma = makePrisma(PrismaClient);
const audit = (tx, entityType, entityId, action, after) =>
  tx.$executeRawUnsafe(
    `INSERT INTO public.audit_event (entity_type, entity_id, actor_type, actor_id, action, after)
     VALUES ($1, $2, 'system', NULL, $3, $4::jsonb)`,
    entityType,
    entityId,
    action,
    JSON.stringify({ ...after, seed: 'demo' }),
  );

try {
  const farmers = await prisma.$queryRawUnsafe(
    `SELECT id, payam_id, state_id FROM public.farmer_active WHERE id = ANY($1::uuid[])`,
    LISTINGS.map((l) => seedFarmerId(l.farmer)),
  );
  if (farmers.length !== LISTINGS.length) {
    refuse('The placeholder farmers are missing. Run pnpm farmers:seed first.');
  }
  const [admin] = await prisma.$queryRawUnsafe(
    `SELECT id FROM public.user_active WHERE role = 'admin' AND name NOT LIKE 'zztest%' ORDER BY created_at LIMIT 1`,
  );
  if (!admin) refuse('No administrator account that is not a test account. Create one first.');
  const farmerById = new Map(farmers.map((f) => [f.id, f]));

  let created = 0;

  // ---- Listings ---------------------------------------------------------
  for (const l of LISTINGS) {
    const [exists] = await prisma.$queryRawUnsafe(
      'SELECT id FROM public.produce_listing WHERE id = $1::uuid',
      listingId(l.n),
    );
    if (exists) continue;
    const farmer = farmerById.get(seedFarmerId(l.farmer));
    await prisma.$transaction(async (tx) => {
      await tx.$executeRawUnsafe(
        `INSERT INTO public.produce_listing
           (id, farmer_id, trading_name, title, category, product_name, description, quantity, unit,
            price_ssp, price_per, negotiable, available_from, harvest_season, contact_phone, status,
            payam_id, state_id, quality_grade, min_order_quantity)
         VALUES ($1::uuid, $2::uuid, $3, $4, $5::public.listing_category, $6, $7, $8, $9::public.listing_unit,
                 $10, $9::public.listing_unit, true, CURRENT_DATE, '2026-main', $11, 'listed',
                 $12, $13, $14::public.listing_grade, $15)`,
        listingId(l.n),
        farmer.id,
        `Demo Placeholder Farm ${l.n}`,
        `${l.product} — demo listing`,
        l.category,
        l.product,
        'DEMONSTRATION DATA. Invented for testing the buyer screens.',
        l.qty,
        l.unit,
        l.price,
        `+21191000${String(900 + l.n).padStart(4, '0')}`,
        farmer.payam_id,
        farmer.state_id,
        l.grade,
        l.moq,
      );
      await audit(tx, 'produce_listing', listingId(l.n), 'listing.created', {
        product_name: l.product,
        status: 'listed',
      });
    });
    created += 1;
  }

  // ---- Organisations and their buyers -----------------------------------
  for (const o of ORGS) {
    const [exists] = await prisma.$queryRawUnsafe(
      'SELECT id FROM public.buyer_organization WHERE id = $1::uuid',
      orgId(o.n),
    );
    if (exists) continue;
    const email = `demo-buyer-${o.n}@example.invalid`;
    const authUserId = await createAuthAccount(email);
    await prisma.$transaction(async (tx) => {
      await tx.$executeRawUnsafe(
        `INSERT INTO public.buyer_organization
           (id, name, organization_type, country_code, city, description, interested_categories,
            interested_products, preferred_state_ids, min_quantity, max_quantity, preferred_unit,
            delivery_locations, purchasing_months, payment_preferences, verification_status,
            verified_at, verified_by, account_type)
         VALUES ($1::uuid, $2, $3::public.buyer_organization_type, $4, $5, $6,
                 $7::public.listing_category[], $8::text[], ARRAY['CE']::text[], 500, 20000, 'kg',
                 ARRAY['Juba']::text[], ARRAY[9,10,11]::smallint[],
                 ARRAY['bank_transfer']::public.buyer_payment_preference[],
                 $9::public.buyer_verification_status,
                 CASE WHEN $12::boolean THEN now() END,
                 CASE WHEN $12::boolean THEN $10::uuid END,
                 $11::public.buyer_account_type)`,
        orgId(o.n),
        o.name,
        o.type,
        o.country,
        o.city,
        'DEMONSTRATION DATA. An invented organisation for testing the buyer screens.',
        o.categories,
        o.products,
        o.status,
        admin.id,
        o.account ?? 'business',
        o.status === 'verified',
      );
      await tx.$executeRawUnsafe(
        `INSERT INTO public.buyer (id, auth_user_id, organization_id, given_name, family_name, phone)
         VALUES ($1::uuid, $2::uuid, $3::uuid, 'Placeholder', $4, $5)`,
        buyerId(o.n),
        authUserId,
        orgId(o.n),
        `Buyer ${o.n}`,
        `+254700000${String(o.n).padStart(3, '0')}`,
      );
      await audit(tx, 'buyer_organization', orgId(o.n), 'buyer.registered', {
        buyer_id: buyerId(o.n),
        organization_type: o.type,
        verification_status: o.status,
      });
    });
    console.log(`  ${email} — ${o.status}`);
    created += 1;
  }

  // ---- Purchase requests -------------------------------------------------
  const REQUESTS = [
    {
      n: 1,
      org: 1,
      listing: 1,
      product: 'Maize',
      qty: 2000,
      unit: 'kg',
      status: 'accepted',
      note: 'Supplier identified in Juba County.',
    },
    {
      n: 2,
      org: 1,
      listing: 2,
      product: 'Sorghum',
      qty: 40,
      unit: 'bag_50kg',
      status: 'submitted',
      note: null,
    },
    {
      n: 3,
      org: 1,
      listing: null,
      product: 'Sesame',
      qty: 800,
      unit: 'kg',
      status: 'fulfilled',
      note: 'Delivered in full.',
    },
    {
      n: 4,
      org: 2,
      listing: 3,
      product: 'Sesame',
      qty: 1000,
      unit: 'kg',
      status: 'draft',
      note: null,
    },
    {
      n: 5,
      org: 3,
      listing: null,
      product: 'Cowpea',
      qty: 20,
      unit: 'bag_50kg',
      status: 'draft',
      note: null,
    },
  ];
  for (const r of REQUESTS) {
    const [exists] = await prisma.$queryRawUnsafe(
      'SELECT id FROM public.purchase_request WHERE id = $1::uuid',
      requestId(r.n),
    );
    if (exists) continue;
    const decided = !['draft', 'submitted'].includes(r.status);
    await prisma.$transaction(async (tx) => {
      await tx.$executeRawUnsafe(
        `INSERT INTO public.purchase_request
           (id, organization_id, created_by, listing_id, category, product_name, quantity, unit,
            delivery_location, required_by, notes, status, submitted_at, decision_note, decided_by, decided_at)
         VALUES ($1::uuid, $2::uuid, $3::uuid, $4::uuid, 'crop', $5, $6, $7::public.listing_unit, 'Juba',
                 CURRENT_DATE + 60, 'DEMONSTRATION DATA.', $8::public.purchase_request_status,
                 CASE WHEN $8 = 'draft' THEN NULL ELSE now() END, $9,
                 CASE WHEN $10::boolean THEN $11::uuid END, CASE WHEN $10::boolean THEN now() END)`,
        requestId(r.n),
        orgId(r.org),
        buyerId(r.org),
        r.listing ? listingId(r.listing) : null,
        r.product,
        r.qty,
        r.unit,
        r.status,
        r.note,
        decided,
        admin.id,
      );
      await audit(tx, 'purchase_request', requestId(r.n), 'purchase_request.created', {
        status: r.status,
      });
    });
    created += 1;
  }

  // ---- Orders and their delivery histories -------------------------------
  const ORDERS = [
    {
      n: 1,
      request: 1,
      listing: 1,
      product: 'Maize',
      qty: 2000,
      unit: 'kg',
      price: 820,
      path: ['pending', 'confirmed', 'ready_for_delivery', 'in_transit'],
    },
    {
      n: 2,
      request: 3,
      listing: 3,
      product: 'Sesame',
      qty: 800,
      unit: 'kg',
      price: 2050,
      path: ['pending', 'confirmed', 'ready_for_delivery', 'in_transit', 'delivered', 'completed'],
    },
    {
      n: 3,
      request: null,
      listing: 4,
      product: 'Groundnut',
      qty: 300,
      unit: 'kg',
      price: 1550,
      path: ['pending'],
    },
  ];
  for (const o of ORDERS) {
    const [exists] = await prisma.$queryRawUnsafe(
      'SELECT id FROM public.purchase_order WHERE id = $1::uuid',
      orderId(o.n),
    );
    if (exists) continue;
    const listing = LISTINGS.find((l) => l.n === o.listing);
    await prisma.$transaction(async (tx) => {
      await tx.$executeRawUnsafe(
        `INSERT INTO public.purchase_order
           (id, organization_id, purchase_request_id, listing_id, farmer_id, category, product_name,
            quantity, unit, unit_price_ssp, status, delivery_location, expected_delivery_date, created_by)
         VALUES ($1::uuid, $2::uuid, $3::uuid, $4::uuid, $5::uuid, 'crop', $6, $7, $8::public.listing_unit,
                 $9, $10::public.purchase_order_status, 'Juba', CURRENT_DATE + 14, $11::uuid)`,
        orderId(o.n),
        orgId(1),
        o.request ? requestId(o.request) : null,
        listingId(o.listing),
        seedFarmerId(listing.farmer),
        o.product,
        o.qty,
        o.unit,
        o.price,
        o.path[o.path.length - 1],
        admin.id,
      );
      for (const [i, status] of o.path.entries()) {
        await tx.$executeRawUnsafe(
          `INSERT INTO public.delivery_update (order_id, status, note, recorded_by_user, occurred_at)
           VALUES ($1::uuid, $2::public.purchase_order_status, $3, $4::uuid,
                   now() - make_interval(days => $5::int))`,
          orderId(o.n),
          status,
          `Demonstration entry: ${status.replace(/_/g, ' ')}.`,
          admin.id,
          o.path.length - i,
        );
      }
      await tx.$executeRawUnsafe(
        `INSERT INTO public.notification (buyer_organization_id, channel, title, body)
         VALUES ($1::uuid, 'in_app', 'A new order was arranged',
                 'CORWADO arranged an order for your organisation. Open Orders to see it.')`,
        orgId(1),
      );
      await audit(tx, 'purchase_order', orderId(o.n), 'purchase_order.created', {
        status: o.path[o.path.length - 1],
      });
    });
    created += 1;
  }

  console.log(
    `*** DEMONSTRATION BUYER DATA: ${created} records created. Every row is invented. ***`,
  );
  console.log('Sign in as demo-buyer-1@example.invalid (verified business), -2 (under review),');
  console.log('-3 (pending business) or -4 (individual, no review needed),');
  console.log('with the password in BUYER_DEMO_PASSWORD.');
} finally {
  await prisma.$disconnect();
}
