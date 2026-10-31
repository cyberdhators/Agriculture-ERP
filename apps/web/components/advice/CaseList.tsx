'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';

import { ADVICE_CASE_STATUSES, type AdviceCaseStatus, type AdviceCaseView } from '@agri-erp/shared';

import { ButtonLink, EmptyState, Notice, PageHeader, Tabs } from '@/components/ui';
import { AdviceError, listCases } from '@/lib/advice/client';
import { OUTCOME_KEY, STATUS_KEY, TOPIC_KEY, caseHref } from '@/lib/advice/labels';
import { formatDate } from '@/lib/format';
import { t, type Language } from '@/lib/i18n';

import styles from './advice.module.css';

/**
 * A LIST OF ADVICE REQUESTS (2026-10-22), in Open / In progress / Closed
 * tabs. `role="requester"` is "My advice requests" (questions this account
 * sent); `role="provider"` is "My Advisory Work" (questions sent to its
 * advice profile). Each row opens the request's page on this side of the app.
 *
 * 2026-10-31: one title (its lead only said the title again), with "Find
 * advice" beside it.
 */
export function CaseList({
  lang,
  role,
  side,
  findHref,
}: {
  lang: Language;
  role: 'requester' | 'provider';
  side: 'farmer' | 'buyer';
  findHref: string;
}) {
  const [rows, setRows] = useState<AdviceCaseView[] | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const [tab, setTab] = useState<AdviceCaseStatus>('open');

  useEffect(() => {
    let cancelled = false;
    listCases(role)
      .then((got) => {
        if (!cancelled) setRows(got);
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        setRows([]);
        setFailure(e instanceof AdviceError ? e.message : String(e));
      });
    return () => {
      cancelled = true;
    };
  }, [role]);

  const shown = (rows ?? []).filter((r) => r.status === tab);
  const requester = role === 'requester';

  return (
    <div className={styles.narrow}>
      <PageHeader
        title={t(requester ? 'advice.myRequests' : 'advice.work', lang)}
        actions={
          requester ? (
            <ButtonLink href={findHref} variant="secondary">
              {t('advice.find', lang)}
            </ButtonLink>
          ) : undefined
        }
      />
      <Tabs
        label={t(requester ? 'advice.myRequests' : 'advice.work', lang)}
        value={tab}
        onChange={setTab}
        items={ADVICE_CASE_STATUSES.map((s) => ({
          key: s,
          label: t(STATUS_KEY[s], lang),
          count: rows ? rows.filter((r) => r.status === s).length : undefined,
        }))}
      />
      {failure ? (
        <Notice kind="error">
          <p className="small">{failure}</p>
        </Notice>
      ) : null}
      {rows === null ? (
        <p className="muted">{t('market.loading', lang)}</p>
      ) : shown.length === 0 ? (
        <EmptyState
          title={t(requester ? 'advice.requestsEmpty' : 'advice.workEmpty', lang)}
          body={t(requester ? 'advice.requestsEmptyBody' : 'advice.workEmptyBody', lang)}
        />
      ) : (
        <ul className={styles.rows}>
          {shown.map((r) => (
            <li key={r.id}>
              <Link href={caseHref(side, r.id)} className={styles.card}>
                <span className={styles.cardHead}>
                  <span className={styles.cardTitle} dir="auto">
                    {requester ? r.provider.display_name : r.requester_name}
                  </span>
                  {r.unread ? (
                    <span className="small">
                      <span className={styles.dot} aria-hidden /> {t('advice.newMessage', lang)}
                    </span>
                  ) : null}
                </span>
                <span className={styles.meta}>
                  <span>{t(TOPIC_KEY[r.topic], lang)}</span>
                  <span>{formatDate(r.created_at, lang)}</span>
                  {r.outcome ? <span>{t(OUTCOME_KEY[r.outcome], lang)}</span> : null}
                </span>
                <p className={`${styles.clamp} small`} dir="auto">
                  {r.question}
                </p>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
