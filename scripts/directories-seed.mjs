// Seeds PLACEHOLDER directory entries and learning resources into staging.
// Run with `pnpm directories:seed`. Unit P1, C-13.
//
// Idempotent: every row has a fixed id, so running twice changes nothing.
// Separate from prisma/seed.mjs on purpose: that file is B2's, and the two
// lanes do not edit each other's files (docs/HANDOFF.md).
//
// EVERY ROW HERE IS INVENTED. The names, phone numbers and files are made up
// so that a screen has something to show. None of it is CORWADO data, and the
// phone numbers are not real numbers. Real directory content is entered by
// CORWADO's administrator through the web portal once it exists. Real data
// exists in production only -- CLAUDE.md, "Personal data".
//
// The payam codes are B2's placeholder codes and will change when I-07 arrives.

import { PrismaClient } from '@prisma/client';

import { makePrisma } from './locations-lib.mjs';

const prisma = makePrisma(PrismaClient);

const PLACEHOLDER_BANNER =
  '*** PLACEHOLDER DIRECTORY DATA: invented names and numbers, not CORWADO data ***';

// Fixed ids, so an upsert can find its own row. The all-zero prefix marks a
// row as seed at a glance.
const id = (n) => `00000000-0000-4000-8000-0000000${String(n).padStart(5, '0')}`;

const VERIFIED = new Date('2026-09-01');

const entries = [
  {
    id: id(1),
    entryType: 'agro_dealer',
    name: 'Juba Agro Supplies (placeholder)',
    services: ['seeds', 'fertiliser', 'hand tools'],
    phone: '+211910000001',
    payamId: 'CE-JUB-JUB',
    stateId: 'CE',
  },
  {
    id: id(2),
    entryType: 'agro_dealer',
    name: 'Munuki Farm Shop (placeholder)',
    services: ['seeds', 'pesticide'],
    phone: '+211910000002',
    payamId: 'CE-JUB-MUN',
    stateId: 'CE',
  },
  {
    id: id(3),
    entryType: 'input_supplier',
    name: 'Equatoria Seed Company (placeholder)',
    services: ['certified seed', 'bulk fertiliser'],
    phone: '+211910000003',
    payamId: 'CE-JUB-KAT',
    stateId: 'CE',
  },
  {
    id: id(4),
    entryType: 'financial_service',
    name: 'Example Bank, Juba branch (placeholder)',
    services: ['savings', 'agricultural loan'],
    phone: '+211910000004',
    payamId: 'CE-JUB-JUB',
    stateId: 'CE',
    providerClass: 'bank',
  },
  {
    id: id(5),
    entryType: 'financial_service',
    name: 'Rejaf Mobile Money Agent (placeholder)',
    services: ['mobile money', 'cash out'],
    phone: '+211910000005',
    payamId: 'CE-JUB-REJ',
    stateId: 'CE',
    providerClass: 'mobile_money',
  },
];

const resources = [
  {
    id: id(101),
    title: 'Sorghum planting guide (placeholder)',
    topic: 'crop_production',
    crop: 'sorghum',
    language: 'en',
    format: 'pdf',
    storagePath: 'placeholder/sorghum-planting-guide.pdf',
    byteSize: 812_000,
    published: true,
  },
  {
    id: id(102),
    title: 'دليل زراعة الفول السوداني (placeholder)',
    topic: 'crop_production',
    crop: 'groundnut',
    language: 'ar',
    format: 'pdf',
    storagePath: 'placeholder/groundnut-guide-ar.pdf',
    byteSize: 1_204_000,
    published: true,
  },
  {
    id: id(103),
    title: 'Post-harvest storage, unpublished draft (placeholder)',
    topic: 'post_harvest',
    language: 'en',
    format: 'video',
    storagePath: 'placeholder/storage-draft.mp4',
    byteSize: 41_000_000,
    published: false,
  },
];

console.log('');
console.log(PLACEHOLDER_BANNER);
console.log('');

for (const e of entries) {
  const { id: rowId, ...rest } = e;
  await prisma.directoryEntry.upsert({
    where: { id: rowId },
    update: {},
    create: { id: rowId, lastVerifiedAt: VERIFIED, ...rest },
  });
}
for (const r of resources) {
  const { id: rowId, ...rest } = r;
  await prisma.learningResource.upsert({
    where: { id: rowId },
    update: {},
    create: { id: rowId, ...rest },
  });
}

console.log(
  `  ${entries.length} directory entries, ${resources.length} learning resources (placeholder).`,
);
console.log('');
await prisma.$disconnect();
