'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';

import { SERVICE_TYPES } from '@agri-erp/shared';

import { VerifiedOrganisationBadge } from '@/components/listings/VerifiedOrganisationBadge';
import { MessageButton } from '@/components/messages/MessageButton';
import { ProfileLink } from '@/components/profiles/PublicProfile';
import { Badge, ButtonLink, EmptyState, Input, Notice, PageHeader } from '@/components/ui';
import { formatDate } from '@/lib/format';
import { t, type Language } from '@/lib/i18n';
import { getService, listServices, type ServiceListing } from '@/lib/market-posts/api';
import { SERVICE_TYPE_KEY } from '@/lib/market-posts/presentation';

import { BackLinkRow, SearchSelect } from './bits';
import { ContactReveal, ReportPost } from './ContactAndReport';
import { MarketSections } from './MarketSections';
import { servicePriceLine, serviceTypeLabel } from './MyServices';
import styles from './market-posts.module.css';

/** "From 20 Oct 2026 until 19 Nov 2026" -- when the service can be booked. */
function availabilityLine(s: ServiceListing, lang: Language): string {
  const from = `${t('svc.from', lang)} ${formatDate(s.available_from, lang)}`;
  return s.available_until
    ? `${from} ${t('svc.until', lang)} ${formatDate(s.available_until, lang)}`
    : from;
}

/**
 * The badge of the organisation that offers the service, when CORWADO staff
 * have verified it (2026-10-31: only organisations are verified). Only when
 * true; never a filter.
 */
function ProviderBadge({ s, lang }: { s: ServiceListing; lang: Language }) {
  return <VerifiedOrganisationBadge verified={s.verified_organisation} lang={lang} />;
}

/**
 * LISTINGS LANE (2026-10-19). Services for hire on the public market --
 * tractor hire, transport, processing, storage, other -- with search and
 * filters (type, state) done on the server. The "Verified organisation"
 * badge is shown, never filtered on.
 */
export function MarketServices({ lang, postHref }: { lang: Language; postHref?: string }) {
  const [q, setQ] = useState('');
  // 2026-10-24: the header search lands here with ?q= (read after mount).
  useEffect(() => {
    const fromUrl = new URLSearchParams(window.location.search).get('q');
    if (fromUrl) setQ(fromUrl);
  }, []);
  const [query, setQuery] = useState('');
  const [type, setType] = useState('');
  const [state, setState] = useState('');
  const [rows, setRows] = useState<ServiceListing[] | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const [states, setStates] = useState<Map<string, string>>(new Map());

  useEffect(() => {
    const id = setTimeout(() => setQuery(q.trim()), 300);
    return () => clearTimeout(id);
  }, [q]);

  useEffect(() => {
    let cancelled = false;
    setRows(null);
    listServices({ q: query, service_type: type, state_id: state })
      .then((data) => {
        if (cancelled) return;
        setRows(data);
        setFailure(null);
        setStates((prev) => {
          const next = new Map(prev);
          for (const s of data) next.set(s.state_id, s.state_name);
          return next;
        });
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        setRows([]);
        setFailure(e instanceof Error ? e.message : String(e));
      });
    return () => {
      cancelled = true;
    };
  }, [query, type, state]);

  const stateOptions = useMemo(
    () => [...states].sort((a, b) => a[1].localeCompare(b[1])),
    [states],
  );

  return (
    <>
      <MarketSections current="services" lang={lang} />
      <PageHeader
        title={t('svc.marketTitle', lang)}
        subtitle={t('svc.marketLead', lang)}
        actions={
          postHref ? (
            <ButtonLink href={postHref} variant="secondary" size="small">
              {t('svc.new', lang)}
            </ButtonLink>
          ) : undefined
        }
      />
      <div className={styles.toolbar}>
        <Input
          type="search"
          aria-label={t('svc.search', lang)}
          placeholder={t('svc.search', lang)}
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        <SearchSelect
          label={t('svc.type', lang)}
          value={type}
          onChange={setType}
          options={SERVICE_TYPES.map((s) => ({ value: s, label: t(SERVICE_TYPE_KEY[s], lang) }))}
          anyLabel={t('svc.anyType', lang)}
        />
        <SearchSelect
          label={t('requests.state', lang)}
          value={state}
          onChange={setState}
          options={stateOptions.map(([value, label]) => ({ value, label }))}
          anyLabel={t('requests.anyState', lang)}
        />
      </div>
      {failure ? (
        <Notice kind="error">
          <p className="small">{failure}</p>
        </Notice>
      ) : null}
      {rows === null ? (
        <p className="muted">{t('market.loading', lang)}</p>
      ) : rows.length === 0 ? (
        <EmptyState title={t('svc.marketEmpty', lang)} body={t('svc.marketLead', lang)} />
      ) : (
        <ul className={styles.list}>
          {rows.map((s) => (
            <li key={s.id} className={styles.card}>
              <div className={styles.cardHead}>
                <Badge tone="sorghum">{serviceTypeLabel(s, lang)}</Badge>
                <ProviderBadge s={s} lang={lang} />
              </div>
              <Link href={`/market/services/${s.id}`} className={styles.cardTitle} dir="auto">
                {s.title}
              </Link>
              <div className={styles.meta}>
                <span dir="auto">
                  {s.location}, {s.state_name}
                </span>
                <span>{availabilityLine(s, lang)}</span>
              </div>
              <span className={styles.price}>{servicePriceLine(s, lang)}</span>
              <span className="small muted" dir="auto">
                {s.trading_name}
              </span>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

/** One service on the public market, with the contact and a report. */
export function MarketServiceDetail({ id, lang }: { id: string; lang: Language }) {
  const [row, setRow] = useState<ServiceListing | null | undefined>(undefined);

  useEffect(() => {
    getService(id)
      .then(setRow)
      .catch(() => setRow(null));
  }, [id]);

  if (row === undefined) return <p className="muted">{t('market.loading', lang)}</p>;
  if (row === null) {
    return (
      <>
        <BackLinkRow href="/market/services" label={t('svc.marketTitle', lang)} />
        <EmptyState title={t('svc.gone', lang)} body={t('requests.goneBody', lang)} />
      </>
    );
  }
  return (
    <div className={styles.detail}>
      <BackLinkRow href="/market/services" label={t('svc.marketTitle', lang)} />
      <ServiceDetailBody row={row} lang={lang} />
    </div>
  );
}

/**
 * 2026-10-28 (user journeys): what a service shows on the market, used by the
 * public page and by the form's preview. In `preview` the actions that need a
 * published post (profile, message, phone, report) are left out.
 */
export function ServiceDetailBody({
  row,
  lang,
  preview = false,
}: {
  row: ServiceListing;
  lang: Language;
  preview?: boolean;
}) {
  return (
    <>
      <div className={styles.cardHead}>
        <Badge tone="sorghum">{serviceTypeLabel(row, lang)}</Badge>
        <ProviderBadge s={row} lang={lang} />
      </div>
      <h1 dir="auto">{row.title}</h1>
      <span className={styles.price}>{servicePriceLine(row, lang)}</span>
      <p className={styles.prose} dir="auto">
        {row.description}
      </p>
      <dl className={styles.meta} style={{ display: 'grid', gap: 6 }}>
        <div>
          <dt className="small muted">{t('svc.location', lang)}</dt>
          <dd dir="auto">
            {row.location} · {row.payam_name ? `${row.payam_name}, ` : ''}
            {row.state_name}
          </dd>
        </div>
        <div>
          <dt className="small muted">{t('svc.availability', lang)}</dt>
          <dd>
            {availabilityLine(row, lang)}
            {row.availability_note ? (
              <>
                {' '}
                · <span dir="auto">{row.availability_note}</span>
              </>
            ) : null}
          </dd>
        </div>
        <div>
          <dt className="small muted">{t('svc.provider', lang)}</dt>
          <dd dir="auto">
            {row.trading_name}{' '}
            {preview ? null : <ProfileLink kind="service" id={row.id} language={lang} />}
          </dd>
        </div>
      </dl>
      {preview ? null : (
        <>
          <MessageButton
            postKind="service"
            postId={row.id}
            language={lang}
            allowed={row.messages_allowed !== false}
          />
          {row.phone_shared ? <ContactReveal kind="services" id={row.id} lang={lang} /> : null}
          <ReportPost kind="services" id={row.id} lang={lang} />
        </>
      )}
    </>
  );
}
