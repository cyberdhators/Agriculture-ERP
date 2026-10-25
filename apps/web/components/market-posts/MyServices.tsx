'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';

import {
  lifecycleStage,
  type LifecycleAction,
  type ServicePriceUnit,
  type ServiceType,
} from '@agri-erp/shared';

import {
  CorrectionNotice,
  CorrectionStamp,
  useOpenCorrections,
} from '@/components/account/Corrections';
import { ButtonLink, EmptyState, Notice } from '@/components/ui';
import { formatSsp } from '@/lib/farmers/listings';
import { t, type Language } from '@/lib/i18n';
import { myServices, updateService, type ServiceListing } from '@/lib/market-posts/api';
import { PRICE_UNIT_KEY, SERVICE_TYPE_KEY, todayLocal } from '@/lib/market-posts/presentation';

import { LifecycleActions, type ActionInput } from './LifecycleActions';
import styles from './market-posts.module.css';

const NEXT_STATUS: Partial<Record<LifecycleAction, string>> = {
  publish: 'active',
  resume: 'active',
  pause: 'paused',
  withdraw: 'withdrawn',
  complete: 'completed',
};

/** "SSP 45,000 / per feddan", "Negotiable", or both. */
export function servicePriceLine(s: ServiceListing, lang: Language): string {
  const parts: string[] = [];
  if (s.price_ssp !== null && s.price_unit) {
    parts.push(
      `${formatSsp(s.price_ssp)} ${t(PRICE_UNIT_KEY[s.price_unit as ServicePriceUnit], lang)}`,
    );
  }
  if (s.negotiable) parts.push(t('requests.negotiable', lang));
  return parts.join(' · ');
}

export const serviceTypeLabel = (s: ServiceListing, lang: Language) =>
  t(SERVICE_TYPE_KEY[s.service_type as ServiceType] ?? 'serviceType.other', lang);

/**
 * LISTINGS LANE (2026-10-19). The farmer's own service listings, every
 * status, each with its lifecycle buttons. No stock, so no sales. Needs
 * signal: these changes are not kept on the phone.
 */
export function MyServices({ lang, basePath }: { lang: Language; basePath: string }) {
  const [rows, setRows] = useState<ServiceListing[] | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  // 2026-10-27: a moderator's correction requests on these posts.
  const corrections = useOpenCorrections('service_listing');

  const load = useCallback(() => {
    myServices()
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

  async function act(s: ServiceListing, input: ActionInput) {
    if (typeof navigator !== 'undefined' && !navigator.onLine) {
      throw new Error(t('requests.needsSignal', lang));
    }
    const body =
      input.action === 'renew'
        ? { available_until: input.date }
        : { status: NEXT_STATUS[input.action] ?? s.status };
    const saved = await updateService(s.id, body);
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
          title={t('svc.mineEmpty', lang)}
          body={t('svc.mineLead', lang)}
          actions={<ButtonLink href={`${basePath}/new`}>{t('svc.new', lang)}</ButtonLink>}
        />
      ) : (
        <ul className={styles.list}>
          {rows.map((s) => (
            <li key={s.id} className={styles.card}>
              <span className={styles.cardTitle} dir="auto">
                {s.title}
              </span>
              {corrections.ids.has(s.id) ? <CorrectionStamp lang={lang} /> : null}
              <div className={styles.meta}>
                <span>{serviceTypeLabel(s, lang)}</span>
                <span dir="auto">{s.location}</span>
              </div>
              <span className={styles.price}>{servicePriceLine(s, lang)}</span>
              <LifecycleActions
                stage={lifecycleStage(s.status, s.available_until, today)}
                lang={lang}
                onAction={(input) => act(s, input)}
                endLabel={t('listingForm.availableUntil', lang)}
                endsOn={s.available_until}
              />
              <div className={styles.cardFoot}>
                <Link href={`${basePath}/${s.id}/edit`} className="small">
                  {t('listings.edit', lang)}
                </Link>
                {s.status === 'active' ? (
                  <Link href={`/market/services/${s.id}`} className="small">
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
