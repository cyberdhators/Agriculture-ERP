'use client';

import { FARMER_ADVICE } from '@/lib/advice/labels';
import { useFarmerSession } from '@/lib/farmer-session';

import { AdviceDirectory } from './AdviceDirectory';
import { CaseDetail } from './CaseDetail';
import { CaseList } from './CaseList';
import { ProviderDetail } from './ProviderDetail';
import { ProviderForm } from './ProviderForm';

/**
 * INDEPENDENT ADVICE (2026-10-22) -- the pages, in the farmer's language when
 * one is signed in. The directory and a provider's page sit under the market
 * layout (public; a signed-in farmer sees them in their workspace); the rest
 * are the farmer's own account pages. The buyer side renders the same
 * components in English from its own pages.
 */

export function AdviceDirectoryPage() {
  const { language } = useFarmerSession();
  return <AdviceDirectory lang={language} base={FARMER_ADVICE.find} />;
}

/**
 * A provider's page on the public side. A request sent from here opens on the
 * farmer's side when a farmer is signed in; otherwise the server answers for
 * whoever is (a buyer's request opens on the buyer side), or asks to sign in.
 */
export function AdviceProviderPage({ id }: { id: string }) {
  const { language, farmer } = useFarmerSession();
  return (
    <ProviderDetail
      id={id}
      lang={language}
      base={FARMER_ADVICE.find}
      side={farmer ? 'farmer' : 'buyer'}
    />
  );
}

export function FarmerAdviceRequestsPage() {
  const { language } = useFarmerSession();
  return <CaseList lang={language} role="requester" side="farmer" findHref={FARMER_ADVICE.find} />;
}

export function FarmerAdvisoryWorkPage() {
  const { language } = useFarmerSession();
  return <CaseList lang={language} role="provider" side="farmer" findHref={FARMER_ADVICE.find} />;
}

export function FarmerAdviceCasePage({ id }: { id: string }) {
  const { language } = useFarmerSession();
  return (
    <CaseDetail
      id={id}
      lang={language}
      requestsHref={FARMER_ADVICE.requests}
      workHref={FARMER_ADVICE.work}
    />
  );
}

export function FarmerOfferAdvicePage() {
  const { language } = useFarmerSession();
  return <ProviderForm lang={language} base={FARMER_ADVICE.find} workHref={FARMER_ADVICE.work} />;
}
