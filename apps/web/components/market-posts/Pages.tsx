'use client';

import { useBuyer } from '@/components/buyer/BuyerShell';
import { PageHead } from '@/components/farmer/AccountShell';
import { ButtonLink, PageHeader } from '@/components/ui';
import { useFarmerSession } from '@/lib/farmer-session';
import { farmerPayamName } from '@/lib/fixtures/farmers';
import { t } from '@/lib/i18n';

import { BuyingRequestForm } from './BuyingRequestForm';
import { MarketRequestDetail, MarketRequests } from './MarketRequests';
import { MarketServiceDetail, MarketServices } from './MarketServices';
import { MyBuyingRequests } from './MyBuyingRequests';
import { MyServices } from './MyServices';
import { ServiceForm } from './ServiceForm';

/**
 * LISTINGS LANE (2026-10-19) -- the pages for buying requests and service
 * listings: on the public market, on the farmer's account, and on the buyer's.
 * Each is a thin client wrapper choosing the language and the paths; the
 * components do the work.
 */

const FARMER_REQUESTS = '/farmer/account/buying-requests';
const FARMER_SERVICES = '/farmer/account/my-services';
const BUYER_REQUESTS = '/buyer/buying-requests';
const BUYER_SERVICES = '/buyer/services';

// ---- The public market ------------------------------------------------------

export function MarketRequestsPage() {
  const { farmer, language } = useFarmerSession();
  // A farmer posts from their account; anyone else through the buyer side,
  // which asks them to sign in first.
  return (
    <MarketRequests
      lang={language}
      postHref={farmer ? `${FARMER_REQUESTS}/new` : `${BUYER_REQUESTS}/new`}
    />
  );
}

export function MarketRequestDetailPage({ id }: { id: string }) {
  const { language } = useFarmerSession();
  return <MarketRequestDetail id={id} lang={language} />;
}

export function MarketServicesPage() {
  const { farmer, language } = useFarmerSession();
  // 2026-10-26: any account offers services; anyone not signed in as a farmer
  // goes through the buyer side, which asks them to sign in first.
  return (
    <MarketServices
      lang={language}
      postHref={farmer ? `${FARMER_SERVICES}/new` : `${BUYER_SERVICES}/new`}
    />
  );
}

export function MarketServiceDetailPage({ id }: { id: string }) {
  const { language } = useFarmerSession();
  return <MarketServiceDetail id={id} lang={language} />;
}

// ---- The farmer's account ------------------------------------------------------

export function FarmerBuyingRequestsPage() {
  const { farmer, language } = useFarmerSession();
  if (!farmer) return null;
  return (
    <>
      <PageHead
        title={t('requests.mineTitle', language)}
        lead={t('requests.mineLead', language)}
        actions={
          <ButtonLink href={`${FARMER_REQUESTS}/new`}>{t('requests.new', language)}</ButtonLink>
        }
      />
      <MyBuyingRequests lang={language} basePath={FARMER_REQUESTS} />
    </>
  );
}

export function FarmerBuyingRequestFormPage({ id }: { id?: string }) {
  const { farmer, language, listingsFor } = useFarmerSession();
  if (!farmer) return null;
  return (
    <>
      <PageHead
        title={t(id ? 'requests.editTitle' : 'requests.newTitle', language)}
        lead={t('requests.formLead', language)}
      />
      <BuyingRequestForm
        lang={language}
        id={id}
        listHref={FARMER_REQUESTS}
        defaultName={listingsFor(farmer.id)[0]?.trading_name ?? ''}
        defaultStateId={farmer.state_id ? farmer.state_id : ''}
      />
    </>
  );
}

export function FarmerServicesPage() {
  const { farmer, language } = useFarmerSession();
  if (!farmer) return null;
  return (
    <>
      <PageHead
        title={t('svc.mineTitle', language)}
        lead={t('svc.mineLead', language)}
        actions={<ButtonLink href={`${FARMER_SERVICES}/new`}>{t('svc.new', language)}</ButtonLink>}
      />
      <MyServices lang={language} basePath={FARMER_SERVICES} />
    </>
  );
}

export function FarmerServiceFormPage({ id }: { id?: string }) {
  const { farmer, language, listingsFor } = useFarmerSession();
  if (!farmer) return null;
  return (
    <>
      <PageHead
        title={t(id ? 'svc.editTitle' : 'svc.newTitle', language)}
        lead={t('svc.formLead', language)}
      />
      <ServiceForm
        lang={language}
        id={id}
        listHref={FARMER_SERVICES}
        defaultName={listingsFor(farmer.id)[0]?.trading_name ?? ''}
        defaultLocation={farmer.payam_id ? farmerPayamName(farmer.payam_id) : ''}
        defaultStateId={farmer.state_id ? farmer.state_id : ''}
        farmerNeedsState={!farmer.state_id}
        payamName={farmer.payam_id ? farmerPayamName(farmer.payam_id) : null}
      />
    </>
  );
}

// ---- The buyer's account (English, as the rest of the buyer side) -------------

export function BuyerBuyingRequestsPage() {
  return (
    <>
      <PageHeader
        title={t('requests.mineTitle', 'en')}
        subtitle={t('requests.mineLeadBuyer', 'en')}
        actions={<ButtonLink href={`${BUYER_REQUESTS}/new`}>{t('requests.new', 'en')}</ButtonLink>}
      />
      <MyBuyingRequests lang="en" basePath={BUYER_REQUESTS} />
    </>
  );
}

export function BuyerBuyingRequestFormPage({ id }: { id?: string }) {
  return (
    <>
      <PageHeader
        title={t(id ? 'requests.editTitle' : 'requests.newTitle', 'en')}
        subtitle={t('requests.formLead', 'en')}
      />
      <BuyingRequestForm lang="en" id={id} listHref={BUYER_REQUESTS} posterType="buyer" />
    </>
  );
}

/**
 * 2026-10-26: a buyer account's own services -- an institute, college,
 * research body, advisory organisation or adviser offers them as a farmer
 * does. Inside the buyer shell, so the organisation is known.
 */
export function BuyerServicesPage() {
  return (
    <>
      <PageHeader
        title={t('svc.mineTitle', 'en')}
        subtitle={t('svc.mineLead', 'en')}
        actions={<ButtonLink href={`${BUYER_SERVICES}/new`}>{t('svc.new', 'en')}</ButtonLink>}
      />
      <MyServices lang="en" basePath={BUYER_SERVICES} />
    </>
  );
}

export function BuyerServiceFormPage({ id }: { id?: string }) {
  const { profile } = useBuyer();
  const org = profile.organization;
  // The organisation's name is the name on the market unless changed.
  return (
    <>
      <PageHeader
        title={t(id ? 'svc.editTitle' : 'svc.newTitle', 'en')}
        subtitle={t('svc.formLead', 'en')}
      />
      <ServiceForm
        lang="en"
        id={id}
        listHref={BUYER_SERVICES}
        poster="buyer"
        defaultName={org.name}
        defaultStateId={org.state_id ?? ''}
        defaultLocation={org.city ?? ''}
      />
    </>
  );
}
