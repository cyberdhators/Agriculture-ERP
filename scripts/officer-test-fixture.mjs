/**
 * A LOCAL-TEST OFFICER AND A CASELOAD TO CLICK THROUGH, on staging.
 *
 * Development only. It exists so a person can sign in to the officer portal on
 * their own machine and exercise the real screens against the real API, with
 * the real `requireRole` and caseload checks in the path. It creates NOTHING
 * that the application would not create, and it weakens no rule.
 *
 * EVERYTHING IT MAKES IS MARKED. Officers are named `zztest...`; farmers carry
 * the family name `Zztestfamily`. Those are exactly the markers
 * `tests/helpers/principals.ts` sweeps, so `pnpm test` removes all of it --
 * which also means a test run DELETES this fixture. Re-run this script to get
 * it back.
 *
 * It refuses to run unless both connection strings positively identify the
 * staging project, the same guard `scripts/db-reset.mjs` carries and for the
 * same reason: this creates authentication accounts.
 *
 *   node scripts/with-env.mjs node scripts/officer-test-fixture.mjs
 */
import { randomUUID } from 'node:crypto';

import { PrismaClient } from '@prisma/client';

const STAGING_PROJECT_REF = 'xmmxbrxmfgodhpwolrvk';
const PREFIX = 'zztest';
const FAMILY = 'Zztestfamily';
const PAYAM = 'CE-JUB-MUN';

const OFFICERS = [
  { key: 'A', name: `${PREFIX} Field Officer`, phone: '+211921000501' },
  { key: 'B', name: `${PREFIX} Other Officer`, phone: '+211921000502' },
];
const PASSWORD = 'zztest-officer-2026';

function assertStaging() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? '';
  const db = process.env.DIRECT_URL ?? process.env.DATABASE_URL ?? '';
  if (!url.includes(STAGING_PROJECT_REF) || !db.includes(STAGING_PROJECT_REF)) {
    throw new Error(
      'officer-test-fixture refuses to run: the Supabase URL and the database URL must both ' +
        `identify the staging project (${STAGING_PROJECT_REF}). It creates authentication ` +
        'accounts and must never point at production.',
    );
  }
}

const env = (n) => {
  const v = process.env[n];
  if (!v) throw new Error(`${n} must be set.`);
  return v;
};

/**
 * The officer's sign-in identifier, FROM THE SHARED HELPER.
 *
 * This was a hardcoded copy of the format and it was wrong -- the domain is
 * `officers.invalid`, not a guessed one -- so the accounts existed under an
 * identifier the login form never computes. Importing the one function that
 * builds it is the only way the two cannot disagree.
 */
const { officerAuthIdentifier } = await import('../packages/shared/src/identity.ts');
const authIdentifier = (phone) => officerAuthIdentifier(phone);

// globalThis.fetch, not bare fetch: the same convention as
// scripts/bird-sms-verify.mjs, and what the lint config expects here.
async function auth(path, { method = 'GET', body, key }) {
  const res = await globalThis.fetch(`${env('NEXT_PUBLIC_SUPABASE_URL')}${path}`, {
    method,
    headers: { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  let parsed = {};
  try {
    parsed = await res.json();
  } catch {
    /* no body */
  }
  return { status: res.status, body: parsed };
}

const service = () => env('SUPABASE_SERVICE_ROLE_KEY');

/** Removes only what THIS fixture marks. Never touches an unmarked row. */
async function sweep(prisma) {
  const ids = await prisma.$queryRawUnsafe(
    `SELECT auth_user_id FROM public.officer WHERE name LIKE '${PREFIX}%'`,
  );
  for (const { auth_user_id } of ids) {
    await auth(`/auth/v1/admin/users/${auth_user_id}`, { method: 'DELETE', key: service() });
  }
  const farmerScope = `(SELECT id FROM public.farmer WHERE family_name = '${FAMILY}')`;
  const officerScope = `(SELECT id FROM public.officer WHERE name LIKE '${PREFIX}%')`;
  for (const sql of [
    `DELETE FROM public.visit_attachment WHERE visit_id IN (SELECT id FROM public.visit WHERE farmer_id IN ${farmerScope})`,
    `DELETE FROM public.visit WHERE farmer_id IN ${farmerScope} OR officer_id IN ${officerScope}`,
    `DELETE FROM public.crop_declaration WHERE farm_id IN (SELECT id FROM public.farm WHERE farmer_id IN ${farmerScope})`,
    `DELETE FROM public.farm_boundary WHERE farm_id IN (SELECT id FROM public.farm WHERE farmer_id IN ${farmerScope})`,
    `DELETE FROM public.farm WHERE farmer_id IN ${farmerScope}`,
    `DELETE FROM public.verification_event WHERE farmer_id IN ${farmerScope} OR officer_id IN ${officerScope}`,
  ]) {
    await prisma.$executeRawUnsafe(sql);
  }
  await prisma.$transaction([
    prisma.$executeRawUnsafe(`DELETE FROM public.consent WHERE farmer_id IN ${farmerScope}`),
    prisma.$executeRawUnsafe(`DELETE FROM public.farmer WHERE family_name = '${FAMILY}'`),
  ]);
  await prisma.$executeRawUnsafe(`DELETE FROM public.officer WHERE name LIKE '${PREFIX}%'`);
}

async function makeOfficer(prisma, { name, phone }, payam) {
  const identifier = authIdentifier(phone);
  const created = await auth('/auth/v1/admin/users', {
    method: 'POST',
    key: service(),
    body: { email: identifier, password: PASSWORD, email_confirm: true },
  });
  if (created.status >= 300) {
    throw new Error(`Could not create ${name}: ${created.status} ${JSON.stringify(created.body)}`);
  }
  const id = randomUUID();
  await prisma.$executeRawUnsafe(
    `INSERT INTO public.officer (id, auth_user_id, name, phone, payam_id, state_id, status)
     VALUES ($1::uuid, $2::uuid, $3, $4, $5, $6, 'active')`,
    id,
    created.body.id,
    name,
    phone,
    payam.id,
    payam.state_id,
  );
  return { id, name, phone, identifier, authUserId: created.body.id };
}

/** One farmer and its consent, in the order the deferred keys allow. */
async function makeFarmer(prisma, payam, officer, spec) {
  const farmerId = randomUUID();
  const consentId = randomUUID();
  await prisma.$transaction([
    prisma.$executeRawUnsafe(
      `INSERT INTO public.farmer
         (id, farmer_number, given_name, family_name, sex, year_of_birth, phone, national_id,
          payam_id, county_id, state_id, registered_by, registration_source, verification_status,
          consent_id, caseload_officer_id, created_at)
       VALUES ($1::uuid, $2, $3, $4, $5::public.sex, $6, $7, $8, $9, $10, $11, $12::uuid,
               'officer', $13::public.verification_status, $14::uuid, $15::uuid, $16::timestamptz)`,
      farmerId,
      spec.number,
      spec.given,
      FAMILY,
      spec.sex,
      spec.year,
      spec.phone,
      spec.nationalId ?? null,
      payam.id,
      payam.county_id,
      payam.state_id,
      officer.id,
      spec.status,
      consentId,
      officer.id,
      spec.createdAt,
    ),
    prisma.$executeRawUnsafe(
      `INSERT INTO public.consent (id, farmer_id, text_version, language, granted)
       VALUES ($1::uuid, $2::uuid, 'v1.0-en', 'en'::public.language, true)`,
      consentId,
      farmerId,
    ),
  ]);
  return { id: farmerId, ...spec };
}

const ring = (lng, lat, d) =>
  JSON.stringify({
    type: 'Polygon',
    coordinates: [
      [
        [lng, lat],
        [lng + d, lat],
        [lng + d, lat + d],
        [lng, lat + d],
        [lng, lat],
      ],
    ],
  });

async function makeFarm(prisma, payam, officer, farmer, season, boundaries, crops) {
  const farmId = randomUUID();
  await prisma.$executeRawUnsafe(
    `INSERT INTO public.farm (id, farmer_id, payam_id, county_id, state_id, season, created_by)
     VALUES ($1::uuid, $2::uuid, $3, $4, $5, $6, $7::uuid)`,
    farmId,
    farmer.id,
    payam.id,
    payam.county_id,
    payam.state_id,
    season,
    officer.id,
  );
  for (const b of boundaries) {
    await prisma.$executeRawUnsafe(
      `WITH g AS (
         SELECT extensions.ST_ForcePolygonCCW(
                  extensions.ST_SetSRID(extensions.ST_GeomFromGeoJSON($3), 4326)
                )::extensions.geography AS geog
       )
       INSERT INTO public.farm_boundary
         (id, farm_id, season, boundary, centroid, area_ha, point_count, gps_accuracy_m,
          accuracy_flag, mapped_by, is_current, mapped_at)
       SELECT $1::uuid, $2::uuid, $4, g.geog, extensions.ST_Centroid(g.geog),
              round((extensions.ST_Area(g.geog) / 10000)::numeric, 4), 4, $5,
              $6::public.accuracy_flag, $7::uuid, $8, $9::timestamptz
       FROM g`,
      randomUUID(),
      farmId,
      b.ring,
      season,
      b.accuracy,
      b.flag,
      officer.id,
      b.current,
      b.mappedAt,
    );
  }
  for (const crop of crops) {
    await prisma.$executeRawUnsafe(
      `INSERT INTO public.crop_declaration (farm_id, season, crop, declared_by)
       VALUES ($1::uuid, $2, $3::public.crop, $4::uuid)`,
      farmId,
      season,
      crop,
      officer.id,
    );
  }
  return farmId;
}

async function makeVisit(prisma, payam, officer, farmer, spec) {
  const id = randomUUID();
  await prisma.$executeRawUnsafe(
    `INSERT INTO public.visit
       (id, farmer_id, officer_id, payam_id, county_id, state_id, position, gps_accuracy_m,
        observation, advice, topics, duration_minutes, attendee_count, follow_up_of,
        visited_at, received_at)
     VALUES ($1::uuid, $2::uuid, $3::uuid, $4, $5, $6,
             extensions.ST_SetSRID(extensions.ST_GeomFromGeoJSON($7), 4326)::extensions.geography,
             $8, $9, $10, $11::public.visit_topic[], $12, $13, $14::uuid, $15::timestamptz, $16::timestamptz)`,
    id,
    farmer.id,
    officer.id,
    payam.id,
    payam.county_id,
    payam.state_id,
    JSON.stringify({ type: 'Point', coordinates: [31.5825, 4.8594] }),
    spec.accuracy,
    spec.observation ?? null,
    spec.advice,
    spec.topics,
    spec.duration ?? null,
    spec.attendees ?? null,
    spec.followUpOf ?? null,
    spec.visitedAt,
    spec.receivedAt,
  );
  return id;
}

const iso = (daysAgo, hour = 9) => {
  const d = new Date();
  d.setDate(d.getDate() - daysAgo);
  d.setHours(hour, 0, 0, 0);
  return d.toISOString();
};

async function main() {
  assertStaging();
  const prisma = new PrismaClient({ datasources: { db: { url: process.env.DIRECT_URL } } });

  const [payam] = await prisma.$queryRawUnsafe(
    'SELECT id, county_id, state_id FROM public.payam_active WHERE id = $1',
    PAYAM,
  );
  if (!payam) throw new Error(`Payam ${PAYAM} not found.`);

  await sweep(prisma);

  const officerA = await makeOfficer(prisma, OFFICERS[0], payam);
  const officerB = await makeOfficer(prisma, OFFICERS[1], payam);

  const specs = [
    {
      number: 'ZZTEST-0001',
      given: 'Nyakuor',
      sex: 'f',
      year: 1988,
      phone: '+211921000601',
      status: 'pending',
      createdAt: iso(2),
      note: 'PENDING — edit it',
    },
    {
      number: 'ZZTEST-0002',
      given: 'Deng',
      sex: 'm',
      year: 1979,
      phone: '+211921000602',
      status: 'rejected',
      createdAt: iso(9),
      note: 'REJECTED — correct and resubmit',
    },
    {
      number: 'ZZTEST-0003',
      given: 'Achol',
      sex: 'f',
      year: 1995,
      phone: '+211921000603',
      status: 'verified',
      nationalId: 'SSD1234567',
      createdAt: iso(30),
      note: 'VERIFIED — read-only; editing must be refused',
    },
    {
      number: 'ZZTEST-0004',
      given: 'Garang',
      sex: 'm',
      year: 1983,
      phone: '+211921000604',
      status: 'verified',
      createdAt: iso(40),
      note: 'FARM + crops + boundary history — remap here',
    },
    {
      number: 'ZZTEST-0005',
      given: 'Abuk',
      sex: 'f',
      year: 1991,
      phone: '+211921000605',
      status: 'verified',
      createdAt: iso(25),
      note: 'VISITS + follow-up chain',
    },
    {
      number: 'ZZTEST-0006',
      given: 'Lual',
      sex: 'm',
      year: 2000,
      phone: '+211921000606',
      status: 'pending',
      createdAt: iso(1),
      note: 'PENDING, no farm and no visit — map a farm / record a visit',
    },
    {
      number: 'ZZTEST-0007',
      given: 'Adut',
      sex: 'f',
      year: 1986,
      phone: '+211921000607',
      status: 'verified',
      createdAt: iso(60),
      note: 'RECENT VISIT — correct it inside the 24h window',
    },
  ];

  const farmers = [];
  for (const spec of specs) farmers.push(await makeFarmer(prisma, payam, officerA, spec));

  // Officer B's farmer: the one that must be invisible to officer A.
  const hidden = await makeFarmer(prisma, payam, officerB, {
    number: 'ZZTEST-0900',
    given: 'Hidden',
    sex: 'm',
    year: 1990,
    phone: '+211921000900',
    status: 'verified',
    createdAt: iso(5),
    note: "OTHER OFFICER'S — must 404 for officer A",
  });

  // Farmer 4: two boundaries for one season, so the history has a superseded row.
  const farm4 = await makeFarm(
    prisma,
    payam,
    officerA,
    farmers[3],
    '2026-main',
    [
      {
        ring: ring(31.58, 4.85, 0.0012),
        accuracy: 18,
        flag: 'poor',
        current: false,
        mappedAt: iso(40),
      },
      {
        ring: ring(31.58, 4.85, 0.001),
        accuracy: 6,
        flag: 'good',
        current: true,
        mappedAt: iso(12),
      },
    ],
    ['sorghum', 'maize'],
  );
  // A second season on the same farmer, one boundary, no crops declared.
  const farm4b = await makeFarm(
    prisma,
    payam,
    officerA,
    farmers[3],
    '2025-second',
    [
      {
        ring: ring(31.585, 4.855, 0.0008),
        accuracy: 9,
        flag: 'good',
        current: true,
        mappedAt: iso(200),
      },
    ],
    [],
  );

  const v1 = await makeVisit(prisma, payam, officerA, farmers[4], {
    accuracy: 7,
    advice: 'Thin the sorghum to one plant per station and weed before the next rain.',
    observation: 'Striga on the eastern quarter.',
    topics: ['weeding', 'pest'],
    duration: 45,
    attendees: 3,
    visitedAt: iso(20),
    receivedAt: iso(20, 11),
  });
  const v2 = await makeVisit(prisma, payam, officerA, farmers[4], {
    accuracy: 11,
    advice: 'The striga is reduced. Keep weeding on the same schedule.',
    topics: ['weeding'],
    followUpOf: v1,
    visitedAt: iso(6),
    receivedAt: iso(6, 10),
  });
  // Received a moment ago, so the 24-hour correction window is open.
  const v3 = await makeVisit(prisma, payam, officerA, farmers[6], {
    accuracy: 5,
    advice: 'Harvest the groundnut before the rain returns at the weekend.',
    observation: 'Pods filling well.',
    topics: ['harvest', 'storage', 'market'],
    duration: 30,
    attendees: 1,
    visitedAt: iso(0, 8),
    receivedAt: new Date().toISOString(),
  });
  // Old enough that the window is shut.
  await makeVisit(prisma, payam, officerA, farmers[4], {
    accuracy: 22,
    advice: 'Store the seed off the ground and keep it dry.',
    topics: ['storage'],
    visitedAt: iso(45),
    receivedAt: iso(45, 14),
  });

  console.log('\n=== OFFICER TEST FIXTURE CREATED ===\n');
  console.log(`payam            ${payam.id} (${payam.county_id}, ${payam.state_id})`);
  console.log(`officer A        ${officerA.name}  phone ${officerA.phone}  id ${officerA.id}`);
  console.log(`officer B        ${officerB.name}  phone ${officerB.phone}  id ${officerB.id}`);
  console.log(`password         ${PASSWORD}`);
  console.log(`\nfarmers (${farmers.length} for officer A, 1 for officer B):`);
  for (const f of farmers)
    console.log(`  ${f.number}  ${f.given} ${FAMILY}  [${f.status}]  ${f.note}`);
  console.log(`  ${hidden.number}  ${hidden.given} ${FAMILY}  [${hidden.status}]  ${hidden.note}`);
  console.log(
    `\nfarms   2 (farmer ZZTEST-0004): ${farm4} 2026-main (2 boundaries, 1 superseded), ${farm4b} 2025-second`,
  );
  console.log(
    `visits  4: ${v1} (older), ${v2} (follow-up of the first), ${v3} (just received — correctable), 1 outside the window`,
  );
  console.log(`\nhidden farmer id (for the 404 check): ${hidden.id}`);

  await prisma.$disconnect();
}

await main();
