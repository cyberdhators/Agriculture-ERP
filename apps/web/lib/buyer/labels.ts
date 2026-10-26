import type {
  BuyerAccountType,
  BuyerOrganizationType,
  BuyerVerificationStatus,
  ListingCategory,
  ListingGrade,
  ListingUnit,
  PaymentPreference,
  PurchaseOrderStatus,
  PurchaseRequestStatus,
} from '@agri-erp/shared';

import type { StampKind } from '@/components/ui';
import { t, type Language } from '@/lib/i18n';

/**
 * B13 -- every word the buyer screens print for a stored value. Pure, and
 * tested: each Record below is keyed by the full enum, so a value the database
 * can hold and this file cannot name is a type error, not a blank cell.
 */

export const CATEGORY_LABELS: Record<ListingCategory, string> = {
  crop: 'Crops & grains',
  vegetable: 'Vegetables',
  fruit: 'Fruit',
  livestock: 'Livestock',
  poultry: 'Poultry',
  dairy: 'Dairy',
  fish: 'Fish',
  processed: 'Processed goods',
  seeds_inputs: 'Seeds & inputs',
  other: 'Other',
};

export const UNIT_LABELS: Record<ListingUnit, string> = {
  kg: 'kg',
  bag_50kg: '50 kg bag',
  bag_100kg: '100 kg bag',
  sack: 'sack',
  crate: 'crate',
  bunch: 'bunch',
  piece: 'piece',
  head: 'head',
  litre: 'litre',
  tin: 'tin',
};

export const GRADE_LABELS: Record<ListingGrade, string> = {
  a: 'Grade A',
  b: 'Grade B',
  c: 'Grade C',
  ungraded: 'Ungraded',
};

export const ORG_TYPE_LABELS: Record<BuyerOrganizationType, string> = {
  trader: 'Trader',
  aggregator: 'Aggregator',
  processor: 'Processor',
  wholesaler: 'Wholesaler',
  exporter: 'Exporter',
  food_company: 'Food company',
  ngo: 'NGO procurement',
  institution: 'Institution (school, hospital, …)',
  government: 'Government agency',
  other: 'Other',
};

export const PAYMENT_LABELS: Record<PaymentPreference, string> = {
  cash_on_delivery: 'Cash on delivery',
  bank_transfer: 'Bank transfer',
  mobile_money: 'Mobile money',
  cheque: 'Cheque',
  other: 'Other',
};

export const ACCOUNT_TYPE_LABELS: Record<BuyerAccountType, string> = {
  individual: 'Individual buyer',
  business: 'Business',
};

/**
 * 2026-10-31: these words are an ORGANISATION's verification -- a badge, never
 * a gate. An individual sees none of them (BuyerShell shows no stamp for one).
 */
export const VERIFICATION_LABELS: Record<BuyerVerificationStatus, string> = {
  pending: 'Not yet verified',
  under_review: 'Being checked',
  verified: 'Verified organisation',
  rejected: 'Not verified',
  suspended: 'Suspended',
  // Deliberately not "Verified": an individual was never reviewed.
  not_required: 'Active',
};

/**
 * Whether the account wears a standing stamp at all (2026-10-31). An
 * individual is never verified, so an individual in good standing wears none;
 * a suspension -- account standing, not verification -- still shows.
 */
export const showsStandingStamp = (
  accountType: BuyerAccountType,
  status: BuyerVerificationStatus,
): boolean => accountType !== 'individual' || status === 'suspended';

export const VERIFICATION_STAMPS: Record<BuyerVerificationStatus, StampKind> = {
  pending: 'pending',
  under_review: 'info',
  verified: 'verified',
  rejected: 'rejected',
  suspended: 'escalated',
  not_required: 'neutral',
};

/**
 * What the account's standing means, in a sentence the buyer can act on. The
 * dashboard prints this above everything else whenever the account is not
 * verified (C-14B.3).
 */
export const VERIFICATION_MESSAGES: Record<BuyerVerificationStatus, string> = {
  pending:
    'You can browse and send purchase requests now. CORWADO may check your organisation and add a "Verified organisation" badge.',
  under_review:
    'Your organisation is currently under review for a "Verified organisation" badge, and CORWADO may ask you for more information. You can browse and send purchase requests meanwhile.',
  verified:
    'Your organisation is verified: a "Verified organisation" badge shows on its posts and profile.',
  rejected:
    'CORWADO did not verify your organisation, so it shows no badge. You can still browse and send purchase requests. Contact CORWADO if you think this is a mistake.',
  suspended:
    'Your buyer account is suspended. Your history remains readable; the marketplace is closed until CORWADO restores the account.',
  not_required: 'Your account is active. You can browse and send purchase requests.',
};

export const REQUEST_STATUS_LABELS: Record<PurchaseRequestStatus, string> = {
  draft: 'Draft',
  submitted: 'Sent to farmer',
  under_review: 'Under review',
  accepted: 'Farmer accepted',
  partially_fulfilled: 'Partly fulfilled',
  fulfilled: 'Fulfilled',
  cancelled: 'Cancelled',
  rejected: 'Farmer declined',
};

export const REQUEST_STATUS_STAMPS: Record<PurchaseRequestStatus, StampKind> = {
  draft: 'neutral',
  submitted: 'pending',
  under_review: 'info',
  accepted: 'verified',
  partially_fulfilled: 'info',
  fulfilled: 'verified',
  cancelled: 'merged',
  rejected: 'rejected',
};

export const ORDER_STATUS_LABELS: Record<PurchaseOrderStatus, string> = {
  pending: 'Pending',
  confirmed: 'Confirmed',
  processing: 'Processing',
  ready_for_delivery: 'Ready for delivery',
  in_transit: 'In transit',
  delivered: 'Delivered',
  completed: 'Completed',
  cancelled: 'Cancelled',
};

export const ORDER_STATUS_STAMPS: Record<PurchaseOrderStatus, StampKind> = {
  pending: 'pending',
  confirmed: 'info',
  processing: 'info',
  ready_for_delivery: 'info',
  in_transit: 'info',
  delivered: 'verified',
  completed: 'verified',
  cancelled: 'merged',
};

export const MONTH_LABELS = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
] as const;

/** A label for a stored value, falling back to the value itself -- never blank. */
export const labelOf = <K extends string>(table: Record<K, string>, value: string | null) =>
  value === null ? '—' : ((table as Record<string, string>)[value] ?? value);

export const stampOf = <K extends string>(table: Record<K, StampKind>, value: string): StampKind =>
  (table as Record<string, StampKind>)[value] ?? 'neutral';

/** South Sudanese pounds, whole, grouped. The currency is named, never assumed. */
export const formatSsp = (value: number): string =>
  `SSP ${value.toLocaleString('en', { maximumFractionDigits: 2 })}`;

/** "5,000 kg", "12 × 50 kg bag". */
export const formatQuantity = (quantity: number, unit: string): string => {
  const label = labelOf(UNIT_LABELS, unit);
  const n = quantity.toLocaleString('en', { maximumFractionDigits: 2 });
  return unit === 'kg' || unit === 'litre' ? `${n} ${label}` : `${n} × ${label}`;
};

/** "2026-10" → "Oct 2026". */
export const formatMonth = (yyyyMm: string): string => {
  const [year, month] = yyyyMm.split('-');
  const index = Number(month) - 1;
  return `${MONTH_LABELS[index] ?? month} ${year}`;
};

/*
 * 2026-10-29 (Arabic for the email side): the same words in the buyer's
 * language. The English tables above stay the staff portal's; the i18n keys
 * carry the same English (lib/buyer/labels.test.ts holds the two together).
 */

export const verificationLabel = (status: BuyerVerificationStatus, lang: Language = 'en') =>
  t(`buyer.standing.${status}`, lang);

export const verificationMessage = (status: BuyerVerificationStatus, lang: Language = 'en') =>
  t(`buyer.standingMsg.${status}`, lang);

export const orgTypeLabel = (type: BuyerOrganizationType, lang: Language = 'en') =>
  t(`buyer.orgType.${type}`, lang);

export const paymentLabel = (pref: PaymentPreference, lang: Language = 'en') =>
  t(`buyer.pay.${pref}`, lang);

export const categoryLabel = (category: ListingCategory, lang: Language = 'en') =>
  t(`buyer.cat.${category}`, lang);

/** A stored category that this build may not know: the raw value, never blank. */
export const categoryLabelOf = (category: string, lang: Language = 'en') =>
  category in CATEGORY_LABELS
    ? categoryLabel(category as ListingCategory, lang)
    : labelOf(CATEGORY_LABELS, category);

export const unitLabel = (unit: ListingUnit, lang: Language = 'en') => t(`unit.${unit}`, lang);

const MONTH_NUMBERS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12] as const;

/** The twelve month names, January first, in the buyer's language. */
export const monthLabels = (lang: Language = 'en'): string[] =>
  MONTH_NUMBERS.map((m) => t(`buyer.month.${m}`, lang));
