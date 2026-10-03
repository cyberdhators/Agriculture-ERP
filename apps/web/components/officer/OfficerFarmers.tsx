'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';

import { Button, Stamp } from '@/components/ui';
import { UnavailableState } from '@/components/ui/data';
import { LIVE_FARMERS, listFarmers } from '@/lib/farmers/api';
import type { Farmer } from '@/lib/fixtures/farmers';
import {
  canResubmit,
  cardFields,
  caseloadSummary,
  filterFor,
  isStatusTab,
  STATUS_TABS,
  type StatusTab,
} from '@/lib/officer/farmers';
import { formatPhone } from '@/lib/format';

import styles from './officer-farmers.module.css';

/**
 * MY FARMERS — the officer's caseload, on a phone.
 *
 * NOT the administrator's register with columns removed. That screen answers
 * "who is registered across the programme" and needs filters, a printable view
 * and a dense table for it. This answers "who is mine, and which of them is
 * waiting on me", which is a list of people you are going to walk to.
 *
 * SCOPING IS THE SERVER'S. `GET /api/farmers` appends
 * `f.caseload_officer_id = $n` for a caseload principal, so a farmer outside
 * this officer's caseload is not filtered out here -- it was never in the
 * response. Nothing in this file filters for authorisation and nothing should:
 * a client-side predicate standing in for a WHERE clause leaks the day someone
 * edits it.
 *
 * THE CHIPS FILTER ON THE SERVER TOO. `verification_status` is a parameter the
 * route takes, so "Rejected" means every rejected farmer in the caseload, not
 * the rejected ones among the page already downloaded. Changing a chip starts
 * a new query from the first page, because a cursor belongs to the filter that
 * produced it.
 *
 * WHAT IS NOT HERE, AND WHY. No search box: the farmer API has no name, phone
 * or number filter, so a box could only search the page in hand and would lie
 * about the rest. No print and no bulk selection: both are desk shapes, and
 * neither is removed from the administrator's screen. No verify, reject, merge
 * or reassign -- those are a supervisor's, and the only move an officer has on
 * a waiting record is correcting a rejected one.
 */

const PAGE = 20;

type Phase = 'loading' | 'ready' | 'error';

export function OfficerFarmers() {
  const router = useRouter();
  const params = useSearchParams();
  const raw = params?.get('status') ?? null;
  const tab: StatusTab = isStatusTab(raw) ? raw : 'all';

  const [rows, setRows] = useState<Farmer[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [phase, setPhase] = useState<Phase>('loading');
  const [loadingMore, setLoadingMore] = useState(false);
  const [why, setWhy] = useState<string | null>(null);

  const load = useCallback(async (next: StatusTab, after: string | null) => {
    if (!LIVE_FARMERS) {
      setPhase('error');
      setWhy('preview');
      return;
    }
    try {
      const page = await listFarmers({
        ...filterFor(next),
        limit: PAGE,
        ...(after ? { cursor: after } : {}),
      });
      setRows((held) => (after ? [...held, ...page.farmers] : page.farmers));
      setCursor(page.cursor);
      setHasMore(page.hasMore);
      setPhase('ready');
      setWhy(null);
    } catch {
      setPhase('error');
      setWhy('unreachable');
    }
  }, []);

  useEffect(() => {
    setPhase('loading');
    setRows([]);
    setCursor(null);
    void load(tab, null);
  }, [tab, load]);

  const choose = (next: StatusTab) => {
    // The chip lives in the URL so a reload and a back button keep the view.
    const query = next === 'all' ? '' : `?status=${next}`;
    router.replace(`/farmers${query}`, { scroll: false });
  };

  const summary = caseloadSummary(rows, hasMore);

  return (
    <div className={styles.page}>
      <header className={styles.head}>
        <h1 className={styles.title}>My farmers</h1>
        {phase === 'ready' ? (
          <p className={styles.count}>
            {summary.complete
              ? `${summary.shown} ${summary.shown === 1 ? 'farmer' : 'farmers'}`
              : `First ${summary.shown} farmers`}
            {summary.needingAttention > 0 ? (
              <>
                {' · '}
                <span className={styles.attention}>
                  {summary.needingAttention} need{summary.needingAttention === 1 ? 's' : ''}{' '}
                  attention
                </span>
              </>
            ) : null}
          </p>
        ) : (
          <p className={styles.count}>Farmers assigned to you</p>
        )}
      </header>

      {/*
        Registration is the officer's other daily act, and the caseload is where
        they already are. The dashboard offers it too; this saves a trip back.
      */}
      <Link href="/farmers/new" className={styles.register}>
        + Register a farmer
      </Link>

      {/* The four chips. Selected is said by colour, weight and aria-pressed. */}
      <div className={styles.chips} role="group" aria-label="Filter by status">
        {STATUS_TABS.map(({ key, label }) => {
          const on = key === tab;
          return (
            <button
              key={key}
              type="button"
              className={`${styles.chip} ${on ? styles.chipOn : ''}`}
              aria-pressed={on}
              onClick={() => choose(key)}
            >
              {label}
            </button>
          );
        })}
      </div>

      {phase === 'loading' ? (
        <ul className={styles.list} aria-busy="true" aria-label="Loading your farmers">
          {Array.from({ length: 5 }, (_, i) => (
            <li key={i} className={styles.skeleton} aria-hidden="true" />
          ))}
        </ul>
      ) : phase === 'error' ? (
        <UnavailableState title="Your farmers could not be loaded">
          {why === 'preview'
            ? 'This deployment is running on preview data, so no caseload is read.'
            : 'The list could not be read just now. Nothing is missing from your caseload — it was not fetched. Try again in a moment.'}
        </UnavailableState>
      ) : rows.length === 0 ? (
        <div className={styles.empty}>
          {tab === 'all' ? (
            <>
              <p className={styles.emptyTitle}>Your farmer caseload is empty.</p>
              <p className={styles.emptyNote}>
                Farmers you register, and farmers assigned to you, appear here.
              </p>
            </>
          ) : (
            <>
              <p className={styles.emptyTitle}>No farmers match this status.</p>
              <Button variant="secondary" onClick={() => choose('all')} className={styles.backAll}>
                Show all my farmers
              </Button>
            </>
          )}
        </div>
      ) : (
        <>
          <ul className={styles.list}>
            {rows.map((farmer) => (
              <FarmerCard key={farmer.id} farmer={farmer} />
            ))}
          </ul>

          {hasMore ? (
            <Button
              variant="secondary"
              className={styles.more}
              disabled={loadingMore}
              onClick={() => {
                setLoadingMore(true);
                void load(tab, cursor).finally(() => setLoadingMore(false));
              }}
            >
              {loadingMore ? 'Loading…' : 'Load more'}
            </Button>
          ) : (
            <p className={styles.endOfList}>
              That is everyone{tab === 'all' ? ' on your caseload' : ' with this status'}.
            </p>
          )}
        </>
      )}
    </div>
  );
}

const STATUS_WORD: Record<string, string> = {
  pending: 'Pending',
  verified: 'Verified',
  rejected: 'Rejected',
  merged: 'Merged',
};

/**
 * One farmer, tappable end to end.
 *
 * The whole card is the link, so a thumb has the card rather than a word to
 * aim at. The name leads and the farmer number sits under it in mono at a
 * smaller size -- the officer knows people by name and uses the number to
 * confirm, not the other way round.
 */
function FarmerCard({ farmer }: { farmer: Farmer }) {
  const f = cardFields(farmer);
  const resubmit = canResubmit(farmer);
  return (
    <li className={styles.item}>
      <Link href={`/farmers/${farmer.id}`} className={styles.card}>
        <div className={styles.cardTop}>
          <span className={styles.name} dir="auto">
            {f.name}
          </span>
          <Stamp kind={f.status === 'merged' ? 'merged' : f.status}>
            {STATUS_WORD[f.status] ?? f.status}
          </Stamp>
        </div>
        <span className={styles.number}>{f.farmerNumber}</span>
        <div className={styles.meta}>
          {f.phone ? <span>{formatPhone(f.phone)}</span> : null}
          {f.payamId ? <span className={styles.payam}>{f.payamId}</span> : null}
        </div>
        {resubmit ? (
          <span className={styles.needsFix}>
            {f.rejectionReason
              ? `Rejected — ${f.rejectionReason.replace(/_/g, ' ')}. You can correct and resubmit.`
              : 'Rejected. You can correct and resubmit.'}
          </span>
        ) : null}
      </Link>
    </li>
  );
}
