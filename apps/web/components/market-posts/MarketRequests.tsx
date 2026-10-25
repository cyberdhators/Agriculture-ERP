'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';

import { LISTING_CATEGORIES } from '@agri-erp/shared';

import { MessageButton } from '@/components/messages/MessageButton';
import { ProfileLink } from '@/components/profiles/PublicProfile';
import { Badge, EmptyState, Input, Notice } from '@/components/ui';
import { CATEGORY_KEY } from '@/lib/farmers/listings';
import type { ListingCategory } from '@/lib/fixtures/farmers';
import { formatDate } from '@/lib/format';
import { t, type Language } from '@/lib/i18n';
import { getBuyingRequest, listBuyingRequests, type BuyingRequest } from '@/lib/market-posts/api';

import { BackLinkRow, SearchSelect } from './bits';
import { ContactReveal, ReportPost } from './ContactAndReport';
import { MarketSections } from './MarketSections';
import { needLine, offerLine } from './MyBuyingRequests';
import styles from './market-posts.module.css';

/**
 * LISTINGS LANE (2026-10-19). Buying requests on the public market: what
 * farmers and buyers need, where and by when. Search and filters (product,
 * category, state, who posted) are WHERE clauses on the server; the list is
 * what the route returns, newest change first.
 */
export function MarketRequests({ lang, postHref }: { lang: Language; postHref?: string }) {
  const [q, setQ] = useState('');
  // 2026-10-24: the header search lands here with ?q= (read after mount).
  useEffect(() => {
    const fromUrl = new URLSearchParams(window.location.search).get('q');
    if (fromUrl) setQ(fromUrl);
  }, []);
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState('');
  const [state, setState] = useState('');
  const [poster, setPoster] = useState('');
  const [rows, setRows] = useState<BuyingRequest[] | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const [states, setStates] = useState<Map<string, string>>(new Map());

  useEffect(() => {
    const id = setTimeout(() => setQuery(q.trim()), 300);
    return () => clearTimeout(id);
  }, [q]);

  useEffect(() => {
    let cancelled = false;
    setRows(null);
    listBuyingRequests({ q: query, category, state_id: state, poster })
      .then((data) => {
        if (cancelled) return;
        setRows(data);
        setFailure(null);
        // The state filter offers the states that have requests, as seen so far.
        setStates((prev) => {
          const next = new Map(prev);
          for (const r of data) next.set(r.state_id, r.state_name);
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
  }, [query, category, state, poster]);

  const stateOptions = useMemo(
    () => [...states].sort((a, b) => a[1].localeCompare(b[1])),
    [states],
  );

  return (
    <>
      <MarketSections current="requests" lang={lang} />
      <div className={styles.cardHead} style={{ justifyContent: 'space-between' }}>
        <div>
          <h1>{t('requests.marketTitle', lang)}</h1>
          <p className="muted small">{t('requests.marketLead', lang)}</p>
        </div>
        {postHref ? (
          <Link href={postHref} className="small">
            {t('requests.new', lang)}
          </Link>
        ) : null}
      </div>
      <div className={styles.toolbar}>
        <Input
          type="search"
          aria-label={t('requests.search', lang)}
          placeholder={t('requests.search', lang)}
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        <SearchSelect
          label={t('listingForm.category', lang)}
          value={category}
          onChange={setCategory}
          options={LISTING_CATEGORIES.map((c) => ({ value: c, label: t(CATEGORY_KEY[c], lang) }))}
          anyLabel={t('requests.anyCategory', lang)}
        />
        <SearchSelect
          label={t('requests.state', lang)}
          value={state}
          onChange={setState}
          options={stateOptions.map(([value, label]) => ({ value, label }))}
          anyLabel={t('requests.anyState', lang)}
        />
        <SearchSelect
          label={t('requests.postedBy', lang)}
          value={poster}
          onChange={setPoster}
          options={[
            { value: 'farmer', label: t('requests.byFarmer', lang) },
            { value: 'buyer', label: t('requests.byBuyer', lang) },
          ]}
          anyLabel={t('requests.anyPoster', lang)}
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
        <EmptyState title={t('requests.marketEmpty', lang)} body={t('requests.marketLead', lang)} />
      ) : (
        <ul className={styles.list}>
          {rows.map((r) => (
            <li key={r.id} className={styles.card}>
              <div className={styles.cardHead}>
                <Badge tone={r.poster_type === 'buyer' ? 'nile' : 'leaf'}>
                  {t(r.poster_type === 'buyer' ? 'requests.byBuyer' : 'requests.byFarmer', lang)}
                </Badge>
                <span className="small muted">
                  {t(CATEGORY_KEY[r.category as ListingCategory], lang)}
                </span>
              </div>
              <Link href={`/market/requests/${r.id}`} className={styles.cardTitle} dir="auto">
                {needLine(r, lang)}
              </Link>
              <div className={styles.meta}>
                <span dir="auto">
                  {r.location}, {r.state_name}
                </span>
                <span>
                  {t('requests.neededBy', lang)}{' '}
                  <span className="mono">{formatDate(r.needed_by, lang)}</span>
                </span>
              </div>
              <span className={styles.price}>{offerLine(r, lang)}</span>
              <span className="small muted" dir="auto">
                {r.display_name}
              </span>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

/** One buying request on the public market, with the contact and a report. */
export function MarketRequestDetail({ id, lang }: { id: string; lang: Language }) {
  const [row, setRow] = useState<BuyingRequest | null | undefined>(undefined);

  useEffect(() => {
    getBuyingRequest(id)
      .then(setRow)
      .catch(() => setRow(null));
  }, [id]);

  if (row === undefined) return <p className="muted">{t('market.loading', lang)}</p>;
  if (row === null) {
    return (
      <>
        <BackLinkRow href="/market/requests" label={t('requests.marketTitle', lang)} />
        <EmptyState title={t('requests.gone', lang)} body={t('requests.goneBody', lang)} />
      </>
    );
  }
  return (
    <div className={styles.detail}>
      <BackLinkRow href="/market/requests" label={t('requests.marketTitle', lang)} />
      <BuyingRequestDetailBody row={row} lang={lang} />
    </div>
  );
}

/**
 * 2026-10-28 (user journeys): what a buying request shows on the market, used
 * by the public page and by the form's preview. In `preview` the actions that
 * need a published post (profile, message, phone, report) are left out.
 */
export function BuyingRequestDetailBody({
  row,
  lang,
  preview = false,
}: {
  row: BuyingRequest;
  lang: Language;
  preview?: boolean;
}) {
  return (
    <>
      <div className={styles.cardHead}>
        <Badge tone={row.poster_type === 'buyer' ? 'nile' : 'leaf'}>
          {t(row.poster_type === 'buyer' ? 'requests.byBuyer' : 'requests.byFarmer', lang)}
        </Badge>
        <span className="small muted">
          {t(CATEGORY_KEY[row.category as ListingCategory], lang)}
        </span>
      </div>
      <h1 dir="auto">{needLine(row, lang)}</h1>
      <span className={styles.price}>{offerLine(row, lang)}</span>
      <dl className={styles.meta} style={{ display: 'grid', gap: 6 }}>
        <div>
          <dt className="small muted">{t('requests.location', lang)}</dt>
          <dd dir="auto">
            {row.location}, {row.state_name}
          </dd>
        </div>
        <div>
          <dt className="small muted">{t('requests.neededBy', lang)}</dt>
          <dd className="mono">{formatDate(row.needed_by, lang)}</dd>
        </div>
        {row.delivery_terms ? (
          <div>
            <dt className="small muted">{t('requests.deliveryTerms', lang)}</dt>
            <dd className={styles.prose} dir="auto">
              {row.delivery_terms}
            </dd>
          </div>
        ) : null}
        <div>
          <dt className="small muted">{t('requests.postedBy', lang)}</dt>
          <dd dir="auto">
            {row.display_name}{' '}
            {preview ? null : <ProfileLink kind="buying_request" id={row.id} language={lang} />}
          </dd>
        </div>
      </dl>
      {row.description ? (
        <p className={styles.prose} dir="auto">
          {row.description}
        </p>
      ) : null}
      <p className="small muted">{t('requests.notInquiry', lang)}</p>
      {preview ? null : (
        <>
          <MessageButton
            postKind="buying_request"
            postId={row.id}
            language={lang}
            allowed={row.messages_allowed !== false}
          />
          {row.phone_shared ? (
            <ContactReveal kind="buying-requests" id={row.id} lang={lang} />
          ) : null}
          <ReportPost kind="buying-requests" id={row.id} lang={lang} />
        </>
      )}
    </>
  );
}
