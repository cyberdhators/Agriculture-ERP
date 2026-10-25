'use client';

import { AccountActivities } from '@/components/account/AccountActivities';
import { AdviceDirectory } from '@/components/advice/AdviceDirectory';
import { CaseDetail } from '@/components/advice/CaseDetail';
import { CaseList } from '@/components/advice/CaseList';
import { ProviderDetail } from '@/components/advice/ProviderDetail';
import { ProviderForm } from '@/components/advice/ProviderForm';
import { Messages } from '@/components/messages/Messages';
import { OrganisationAdvice } from '@/components/teams/OrganisationAdvice';
import { OrganisationTeam } from '@/components/teams/OrganisationTeam';
import { Organisations } from '@/components/teams/Organisations';
import { BUYER_ADVICE } from '@/lib/advice/labels';

import { useBuyer } from './BuyerShell';

/**
 * 2026-10-29 (Arabic for the email side): the buyer pages whose screens
 * already speak both languages, in the buyer's language -- as
 * components/teams/FarmerPages.tsx does for the farmer side. The page files
 * are server components (metadata), so the language is read here.
 */

export function BuyerAbout() {
  const { language } = useBuyer();
  return <AccountActivities language={language} />;
}

export function BuyerMessages() {
  const { language } = useBuyer();
  return <Messages language={language} />;
}

export function BuyerAdviceDirectory() {
  const { language } = useBuyer();
  return <AdviceDirectory lang={language} base={BUYER_ADVICE.find} />;
}

export function BuyerAdviceProvider({ id }: { id: string }) {
  const { language } = useBuyer();
  return <ProviderDetail id={id} lang={language} base={BUYER_ADVICE.find} side="buyer" />;
}

export function BuyerAdviceOffer() {
  const { language } = useBuyer();
  return <ProviderForm lang={language} base={BUYER_ADVICE.find} workHref={BUYER_ADVICE.work} />;
}

export function BuyerAdviceCases({ role }: { role: 'requester' | 'provider' }) {
  const { language } = useBuyer();
  return <CaseList lang={language} role={role} side="buyer" findHref={BUYER_ADVICE.find} />;
}

export function BuyerAdviceCase({ id }: { id: string }) {
  const { language } = useBuyer();
  return (
    <CaseDetail
      id={id}
      lang={language}
      requestsHref={BUYER_ADVICE.requests}
      workHref={BUYER_ADVICE.work}
    />
  );
}

export function BuyerOrganisations() {
  const { language } = useBuyer();
  return <Organisations side="buyer" language={language} />;
}

export function BuyerOrganisationTeam({ id }: { id: string }) {
  const { language } = useBuyer();
  return <OrganisationTeam id={id} side="buyer" language={language} />;
}

export function BuyerOrganisationAdvice({ id }: { id: string }) {
  const { language } = useBuyer();
  return <OrganisationAdvice id={id} side="buyer" language={language} />;
}
