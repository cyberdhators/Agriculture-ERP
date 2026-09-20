import type {
  Crop,
  DirectoryEntryType,
  FinancialProviderClass,
  Language,
  LearningTopic,
  ResourceFormat,
} from '@agri-erp/shared';

/**
 * FIXTURE DATA for the portal preview. EVERY ROW HERE IS INVENTED.
 *
 * Names, phone numbers, addresses and files are made up so a screen has
 * something to show. None of it is CORWADO data and the phone numbers are not
 * real numbers (CLAUDE.md, "Personal data"). The shapes mirror the P1 tables
 * (docs/data-model-extension.md sections 3 and 4) and the seed in
 * scripts/directories-seed.mjs, so that swapping this file for API responses
 * is a one-line change per screen.
 *
 * Location codes are B2's placeholders and will change when I-07 arrives.
 */

export interface PayamRef {
  id: string;
  name: string;
  countyId: string;
  stateId: string;
}

export interface StateRef {
  id: string;
  name: string;
}

export const STATES: readonly StateRef[] = [{ id: 'CE', name: 'Central Equatoria' }];

export const COUNTIES = [{ id: 'CE-JUB', name: 'Juba', stateId: 'CE' }] as const;

export const PAYAMS: readonly PayamRef[] = [
  ['CE-JUB-JUB', 'Juba'],
  ['CE-JUB-KAT', 'Kator'],
  ['CE-JUB-MUN', 'Munuki'],
  ['CE-JUB-NBA', 'Northern Bari'],
  ['CE-JUB-REJ', 'Rejaf'],
  ['CE-JUB-GAN', 'Ganji'],
  ['CE-JUB-LOK', 'Lokiliri'],
  ['CE-JUB-LOB', 'Lobonok'],
  ['CE-JUB-GON', 'Gondokoro'],
  ['CE-JUB-DOL', 'Dolo'],
  ['CE-JUB-BUN', 'Bungu'],
  ['CE-JUB-MAN', 'Mangalla'],
].map(([id, name]) => ({
  id: id as string,
  name: name as string,
  countyId: 'CE-JUB',
  stateId: 'CE',
}));

export function payamName(id: string): string {
  return PAYAMS.find((p) => p.id === id)?.name ?? id;
}

/** One row of directory_entry, as the API will return it (snake_case). */
export interface DirectoryEntryRow {
  id: string;
  entry_type: DirectoryEntryType;
  name: string;
  description: string | null;
  services: string[];
  contact_name: string | null;
  phone: string;
  alt_phone: string | null;
  email: string | null;
  physical_address: string | null;
  location: { latitude: number; longitude: number } | null;
  payam_id: string;
  state_id: string;
  provider_class: FinancialProviderClass | null;
  last_verified_at: string;
  verified_by: string | null;
  active: boolean;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
  /** Preview only: the reason given when an entry was removed. */
  removal_note?: string;
}

/** One row of learning_resource, as the API will return it. */
export interface LearningResourceRow {
  id: string;
  title: string;
  topic: LearningTopic;
  crop: Crop | null;
  language: Language;
  format: ResourceFormat;
  storage_path: string;
  byte_size: number;
  description: string | null;
  published: boolean;
  uploaded_by: string | null;
  uploaded_at: string;
  deleted_at: string | null;
}

const id = (n: number) => `00000000-0000-4000-8000-0000000${String(n).padStart(5, '0')}`;

const ADMIN_ID = '11111111-1111-4111-8111-111111111111';

function entry(
  n: number,
  fields: Pick<
    DirectoryEntryRow,
    'entry_type' | 'name' | 'phone' | 'payam_id' | 'last_verified_at'
  > &
    Partial<DirectoryEntryRow>,
): DirectoryEntryRow {
  return {
    id: id(n),
    description: null,
    services: [],
    contact_name: null,
    alt_phone: null,
    email: null,
    physical_address: null,
    location: null,
    state_id: 'CE',
    provider_class: null,
    verified_by: ADMIN_ID,
    active: true,
    created_at: '2026-06-02T08:15:00Z',
    updated_at: `${fields.last_verified_at}T09:00:00Z`,
    deleted_at: null,
    ...fields,
  };
}

export const DIRECTORY_ENTRIES: readonly DirectoryEntryRow[] = [
  entry(1, {
    entry_type: 'agro_dealer',
    name: 'Juba Agro Supplies (placeholder)',
    description:
      'General agro-dealer on the Konyokonyo market road. Stocks certified sorghum and maize seed in season, DAP and urea by the bag, and hand tools.',
    services: ['seeds', 'fertiliser', 'hand tools', 'knapsack sprayers'],
    contact_name: 'Example Owner A',
    phone: '+211910000001',
    alt_phone: '+211920000001',
    email: 'shop@example.invalid',
    physical_address: 'Konyokonyo market road, opposite the fuel station, Juba',
    location: { latitude: 4.8517, longitude: 31.6018 },
    payam_id: 'CE-JUB-JUB',
    last_verified_at: '2026-08-20',
  }),
  entry(2, {
    entry_type: 'agro_dealer',
    name: 'Munuki Farm Shop (placeholder)',
    services: ['seeds', 'pesticide'],
    contact_name: 'Example Owner B',
    phone: '+211910000002',
    physical_address: 'Munuki block C, near the primary school',
    payam_id: 'CE-JUB-MUN',
    last_verified_at: '2026-07-04',
  }),
  entry(3, {
    entry_type: 'input_supplier',
    name: 'Equatoria Seed Company (placeholder)',
    description: 'Wholesale supplier of certified seed and bulk fertiliser. Minimum order 50 kg.',
    services: ['certified seed', 'bulk fertiliser', 'delivery to payam'],
    contact_name: 'Example Sales Desk',
    phone: '+211910000003',
    email: 'orders@example.invalid',
    physical_address: 'Kator industrial area, warehouse 4',
    location: { latitude: 4.8402, longitude: 31.5921 },
    payam_id: 'CE-JUB-KAT',
    last_verified_at: '2026-08-28',
  }),
  entry(4, {
    entry_type: 'financial_service',
    name: 'Example Bank, Juba branch (placeholder)',
    description: 'Savings accounts and seasonal agricultural loans for registered cooperatives.',
    services: ['savings', 'agricultural loan', 'group account'],
    contact_name: 'Example Branch Manager',
    phone: '+211910000004',
    email: 'juba@example.invalid',
    physical_address: 'Ministries road, Juba town',
    location: { latitude: 4.8594, longitude: 31.5713 },
    payam_id: 'CE-JUB-JUB',
    provider_class: 'bank',
    last_verified_at: '2026-08-01',
  }),
  entry(5, {
    entry_type: 'financial_service',
    name: 'Rejaf Mobile Money Agent (placeholder)',
    services: ['mobile money', 'cash out', 'airtime'],
    phone: '+211910000005',
    physical_address: 'Rejaf trading centre, kiosk 2',
    payam_id: 'CE-JUB-REJ',
    provider_class: 'mobile_money',
    last_verified_at: '2026-02-11',
  }),
  entry(6, {
    entry_type: 'agro_dealer',
    name: 'Gudele Inputs Kiosk (placeholder)',
    services: ['seeds', 'vegetable seed', 'fertiliser'],
    contact_name: 'Example Owner C',
    phone: '+211910000006',
    physical_address: 'Gudele one, along the tarmac',
    payam_id: 'CE-JUB-NBA',
    last_verified_at: '2026-01-19',
  }),
  entry(7, {
    entry_type: 'input_supplier',
    name: 'Nile Agri Traders (placeholder)',
    description:
      'Imports pesticide and herbicide by the carton. Sells to dealers, not to individual farmers.',
    services: ['pesticide', 'herbicide', 'bulk fertiliser'],
    contact_name: 'Example Director',
    phone: '+211910000007',
    alt_phone: '+211920000007',
    payam_id: 'CE-JUB-JUB',
    last_verified_at: '2026-06-15',
  }),
  entry(8, {
    entry_type: 'financial_service',
    name: 'Mangalla Farmers SACCO (placeholder)',
    description: 'Savings and credit cooperative for Mangalla payam; members only.',
    services: ['savings', 'small loan', 'input credit'],
    contact_name: 'Example Chairperson',
    phone: '+211910000008',
    physical_address: 'Mangalla centre, next to the health post',
    payam_id: 'CE-JUB-MAN',
    provider_class: 'cooperative_sacco',
    last_verified_at: '2026-08-30',
  }),
  entry(9, {
    entry_type: 'financial_service',
    name: 'Equatoria Microfinance, Kator (placeholder)',
    services: ['group loan', 'savings'],
    contact_name: 'Example Loan Officer',
    phone: '+211910000009',
    email: 'kator@example.invalid',
    payam_id: 'CE-JUB-KAT',
    provider_class: 'microfinance',
    last_verified_at: '2026-05-22',
  }),
  entry(10, {
    entry_type: 'agro_dealer',
    name: 'Lobonok Roadside Dealer (placeholder)',
    services: ['seeds', 'hand tools'],
    phone: '+211910000010',
    payam_id: 'CE-JUB-LOB',
    last_verified_at: '2025-11-03',
  }),
  entry(11, {
    entry_type: 'input_supplier',
    name: 'Gondokoro Nursery (placeholder)',
    description: 'Fruit tree and vegetable seedlings, grafted mango in March.',
    services: ['seedlings', 'grafted fruit trees'],
    contact_name: 'Example Nursery Keeper',
    phone: '+211910000011',
    location: { latitude: 4.9042, longitude: 31.6621 },
    payam_id: 'CE-JUB-GON',
    last_verified_at: '2026-07-29',
  }),
  entry(12, {
    entry_type: 'agro_dealer',
    name: 'Kator Old Market Stall (placeholder)',
    services: ['seeds'],
    phone: '+211910000012',
    payam_id: 'CE-JUB-KAT',
    last_verified_at: '2025-09-10',
    active: false,
    deleted_at: null,
  }),
  entry(13, {
    entry_type: 'financial_service',
    name: 'Village Savings Group, Dolo (placeholder)',
    description: 'Informal VSLA meeting Thursdays. Not a licensed institution.',
    services: ['savings', 'small loan'],
    contact_name: 'Example Secretary',
    phone: '+211910000013',
    payam_id: 'CE-JUB-DOL',
    provider_class: 'other',
    last_verified_at: '2026-04-08',
  }),
  entry(14, {
    entry_type: 'input_supplier',
    name: 'Bungu Fertiliser Depot (placeholder)',
    services: ['bulk fertiliser'],
    phone: '+211910000014',
    payam_id: 'CE-JUB-BUN',
    last_verified_at: '2026-03-14',
    active: false,
    removal_note: 'Depot closed after the May floods; owner confirmed by phone.',
  }),
];

function resource(
  n: number,
  fields: Pick<
    LearningResourceRow,
    'title' | 'topic' | 'language' | 'format' | 'storage_path' | 'byte_size' | 'uploaded_at'
  > &
    Partial<LearningResourceRow>,
): LearningResourceRow {
  return {
    id: id(100 + n),
    crop: null,
    description: null,
    published: true,
    uploaded_by: ADMIN_ID,
    deleted_at: null,
    ...fields,
  };
}

export const LEARNING_RESOURCES: readonly LearningResourceRow[] = [
  resource(1, {
    title: 'Sorghum planting guide (placeholder)',
    topic: 'crop_production',
    crop: 'sorghum',
    language: 'en',
    format: 'pdf',
    storage_path: 'placeholder/sorghum-planting-guide.pdf',
    byte_size: 1_843_200,
    description: 'Row spacing, seed rate and first weeding for the main season. Twelve pages.',
    uploaded_at: '2026-08-12T10:04:00Z',
  }),
  resource(2, {
    title: 'دليل زراعة الذرة الرفيعة (placeholder)',
    topic: 'crop_production',
    crop: 'sorghum',
    language: 'ar',
    format: 'pdf',
    storage_path: 'placeholder/sorghum-planting-guide-ar.pdf',
    byte_size: 2_101_248,
    description: 'Arabic edition of the sorghum planting guide.',
    uploaded_at: '2026-08-12T10:06:00Z',
  }),
  resource(3, {
    title: 'Recognising fall armyworm on maize (placeholder)',
    topic: 'pest_disease',
    crop: 'maize',
    language: 'en',
    format: 'image',
    storage_path: 'placeholder/fall-armyworm-maize.jpg',
    byte_size: 412_672,
    description: 'One annotated photograph: egg mass, larva, and window-pane feeding damage.',
    uploaded_at: '2026-07-30T14:20:00Z',
  }),
  resource(4, {
    title: 'Groundnut drying and storage, radio spot (placeholder)',
    topic: 'post_harvest',
    crop: 'groundnut',
    language: 'ar',
    format: 'audio',
    storage_path: 'placeholder/groundnut-drying-radio.mp3',
    byte_size: 3_276_800,
    uploaded_at: '2026-07-18T09:00:00Z',
  }),
  resource(5, {
    title: 'Sesame harvest timing, field video (placeholder)',
    topic: 'post_harvest',
    crop: 'sesame',
    language: 'en',
    format: 'video',
    storage_path: 'placeholder/sesame-harvest-timing.mp4',
    byte_size: 42_991_616,
    description: 'Draft. Needs Arabic subtitles before it goes out.',
    published: false,
    uploaded_at: '2026-08-29T16:45:00Z',
  }),
  resource(6, {
    title: 'Cowpea intercropping with sorghum (placeholder)',
    topic: 'crop_production',
    crop: 'cowpea',
    language: 'en',
    format: 'pdf',
    storage_path: 'placeholder/cowpea-intercropping.pdf',
    byte_size: 958_464,
    uploaded_at: '2026-06-21T11:30:00Z',
  }),
  resource(7, {
    title: 'Keeping cooperative records (placeholder)',
    topic: 'cooperative',
    language: 'en',
    format: 'pdf',
    storage_path: 'placeholder/cooperative-records.pdf',
    byte_size: 1_212_416,
    description: 'Member register, cash book and the monthly reconciliation, with blank templates.',
    uploaded_at: '2026-05-09T08:10:00Z',
  }),
  resource(8, {
    title: 'Selling as a group: market day checklist (placeholder)',
    topic: 'marketing',
    language: 'ar',
    format: 'image',
    storage_path: 'placeholder/market-day-checklist-ar.png',
    byte_size: 287_744,
    uploaded_at: '2026-08-02T13:15:00Z',
  }),
  resource(9, {
    title: 'Seasonal forecast explained, audio (placeholder)',
    topic: 'climate',
    language: 'ar',
    format: 'audio',
    storage_path: 'placeholder/seasonal-forecast-ar.mp3',
    byte_size: 5_242_880,
    description: 'Four minutes. What the July outlook means for planting dates.',
    published: false,
    uploaded_at: '2026-08-31T07:55:00Z',
  }),
  resource(10, {
    title: 'Goat health basics (placeholder)',
    topic: 'livestock',
    language: 'en',
    format: 'pdf',
    storage_path: 'placeholder/goat-health-basics.pdf',
    byte_size: 2_654_208,
    uploaded_at: '2026-04-27T15:40:00Z',
  }),
];
