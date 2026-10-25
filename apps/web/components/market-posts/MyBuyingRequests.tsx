'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';

import { lifecycleStage, type LifecycleAction } from '@agri-erp/shared';

import {
  CorrectionNotice,
  CorrectionStamp,
  useOpenCorrections,
} from '@/components/account/Corrections';
import { ButtonLink, EmptyState, Notice } from '@/components/ui';
import { CATEGORY_KEY, UNIT_KEY, formatSsp } from '@/lib/farmers/listings';
import type { ListingCategory, ListingUnit } from '@/lib/fixtures/farmers';
import { formatDate } from '@/lib/format';
import { t, type Language } from '@/lib/i18n';
import { myBuyingRequests, updateBuyingRequest, type BuyingRequest } from '@/lib/market-posts/api';
import { todayLocal } from '@/lib/market-posts/presentation';

import { LifecycleActions, type ActionInput } from './LifecycleActions';
import styles from './market-posts.module.css';

const NEXT_STATUS: Partial<Record<LifecycleAction, string>> = {
  publish: 'active',
  resume: 'active',
  pause: 'paused',
  withdraw: 'withdrawn',
  complete: 'completed',
};

/** "40 × 100 kg bag of Sorghum" -- the need, in one line. */
export function needLine(r: BuyingRequest, lang: Language): string {
  const unit = t(UNIT_KEY[r.unit as ListingUnit] ?? 'unit.kg', lang);
  const qty = new Intl.NumberFormat('en-GB', { maximumFractionDigits: 2 }).format(r.quantity);
  return `${qty} × ${unit} · ${r.product_name}`;
}

/** "SSP 30,000 / 100 kg bag", "Negotiable", or both. */
export function offerLine(r: BuyingRequest, lang: Language): string {
  const parts: string[] = [];
  if (r.price_ssp !== null && r.price_per) {
    parts.push(`${formatSsp(r.price_ssp)} / ${t(UNIT_KEY[r.price_per as ListingUnit], lang)}`);
  }
  if (r.negotiable) parts.push(t('requests.negotiable', lang));
  return parts.join(' · ') || t('requests.noPrice', lang);
}

/**
 * LISTINGS LANE (2026-10-19). The signed-in account's own buying requests --
 * a farmer's or a buyer's -- every status, each with its lifecycle buttons:
 * publish, pause, resume, renew (a new "needed by"), mark completed,
 * withdraw. Needs signal: these changes are not kept on the phone.
 */
export function MyBuyingRequests({
  lang,
  basePath,
}: {
  lang: Language;
  /** Where "new" and "edit" live, e.g. /farmer/account/buying-requests. */
  basePath: string;
}) {
  const [rows, setRows] = useState<BuyingRequest[] | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  // 2026-10-27: a moderator's correction requests on these posts.
  const corrections = useOpenCorrections('buying_request');

  const load = useCallback(() => {
    myBuyingRequests()
      .then((data) => {
        setRows(data);
        setFailure(null);
      })
      .catch((e: unknown) => {
        setRows([]);
        setFailure(e instanceof Error ? e.message : String(e));
      });
  }, []);

  useEffect(() => load(), [load]);

  async function act(r: BuyingRequest, input: ActionInput) {
    if (typeof navigator !== 'undefined' && !navigator.onLine) {
      throw new Error(t('requests.needsSignal', lang));
    }
    const body =
      input.action === 'renew'
        ? { needed_by: input.date }
        : { status: NEXT_STATUS[input.action] ?? r.status };
    const saved = await updateBuyingRequest(r.id, body);
    setRows((list) => (list ?? []).map((x) => (x.id === saved.id ? saved : x)));
  }

  if (rows === null) return <p className="muted">{t('market.loading', lang)}</p>;
  const today = todayLocal();

  return (
    <>
      <CorrectionNotice
        items={corrections.items}
        lang={lang}
        editHref={(id) => `${basePath}/${id}/edit`}
      />
      {failure ? (
        <Notice kind="error">
          <p className="small">{failure}</p>
        </Notice>
      ) : null}
      {rows.length === 0 ? (
        <EmptyState
          title={t('requests.mineEmpty', lang)}
          body={t('requests.mineLead', lang)}
          actions={<ButtonLink href={`${basePath}/new`}>{t('requests.new', lang)}</ButtonLink>}
        />
      ) : (
        <ul className={styles.list}>
          {rows.map((r) => (
            <li key={r.id} className={styles.card}>
              <div className={styles.cardHead}>
                <span className={styles.cardTitle} dir="auto">
                  {needLine(r, lang)}
                </span>
                {corrections.ids.has(r.id) ? <CorrectionStamp lang={lang} /> : null}
              </div>
              <div className={styles.meta}>
                <span>{t(CATEGORY_KEY[r.category as ListingCategory], lang)}</span>
                <span dir="auto">
                  {r.location}, {r.state_name}
                </span>
                <span>
                  {t('requests.neededBy', lang)}{' '}
                  <span className="mono">{formatDate(r.needed_by, lang)}</span>
                </span>
              </div>
              <span className={styles.price}>{offerLine(r, lang)}</span>
              <LifecycleActions
                stage={lifecycleStage(r.status, r.needed_by, today)}
                lang={lang}
                onAction={(input) => act(r, input)}
                endLabel={t('requests.neededBy', lang)}
              />
              <div className={styles.cardFoot}>
                <Link href={`${basePath}/${r.id}/edit`} className="small">
                  {t('listings.edit', lang)}
                </Link>
                {r.status === 'active' ? (
                  <Link href={`/market/requests/${r.id}`} className="small">
                    {t('requests.viewOnMarket', lang)}
                  </Link>
                ) : null}
              </div>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
