'use client';

import { useFarmerSession } from '@/lib/farmer-session';

import { ProfileEditor, type ManageLink } from './ProfileEditor';

/**
 * MY PUBLIC PROFILE, on each side of the app (2026-10-23). The farmer side in
 * the farmer's language; the buyer side in English. Each links to where that
 * side manages its posts, and to Delete account (in settings).
 */

const FARMER_MANAGE: readonly ManageLink[] = [
  { href: '/farmer/account/listings', label: 'pp.manageListings' },
  { href: '/farmer/account/my-services', label: 'pp.manageServices' },
  { href: '/farmer/account/buying-requests', label: 'pp.manageRequests' },
];

const BUYER_MANAGE: readonly ManageLink[] = [
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
  return <ProfileEditor language="en" manage={BUYER_MANAGE} deleteHref="/buyer/profile" />;
}
