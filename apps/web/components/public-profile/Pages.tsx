'use client';

import { useBuyer } from '@/components/buyer/BuyerShell';
import { useFarmerSession } from '@/lib/farmer-session';

import { ProfileEditor, type ManageLink } from './ProfileEditor';

/**
 * MY PUBLIC PROFILE, on each side of the app (2026-10-23). The farmer side in
 * the farmer's language; the buyer side in the buyer's (2026-10-29). Each links to where that
 * side manages its posts, and to Delete account (in settings).
 */

const FARMER_MANAGE: readonly ManageLink[] = [
  { href: '/farmer/account/listings', label: 'pp.manageListings' },
  { href: '/farmer/account/my-services', label: 'pp.manageServices' },
  { href: '/farmer/account/buying-requests', label: 'pp.manageRequests' },
];

const BUYER_MANAGE: readonly ManageLink[] = [
  // 2026-10-26: a buyer account offers services too.
  { href: '/buyer/services', label: 'pp.manageServices' },
  { href: '/buyer/buying-requests', label: 'pp.manageRequests' },
];

export function FarmerPublicProfilePage() {
  const { language } = useFarmerSession();
  return (
    <ProfileEditor
      language={language}
      manage={FARMER_MANAGE}
      deleteHref="/farmer/account/security"
    />
  );
}

export function BuyerPublicProfilePage() {
  const { language } = useBuyer();
  return <ProfileEditor language={language} manage={BUYER_MANAGE} deleteHref="/buyer/profile" />;
}
