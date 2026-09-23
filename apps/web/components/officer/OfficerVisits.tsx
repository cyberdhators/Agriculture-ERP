'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';

import { ButtonLink, Button } from '@/components/ui';
import { UnavailableState } from '@/components/ui/data';
import { listVisits, LIVE_VISITS, type Visit } from '@/lib/visits/api';
import { VISIT_TOPIC_LABELS } from '@/lib/visits/fixtures';
import { useVisitNames } from '@/lib/visits/names';
import { usePreview } from '@/lib/preview';
import { correctionState } from '@/lib/officer/visits';
import { formatDate } from '@/lib/format';

import styles from './officer-visits.module.css';

/**
 * MY VISITS — the officer's own record of work, on a phone.
 *
 * NOT the administrator's visit log with columns removed. That screen answers
 * "what extension work is happening across the programme" and needs a dense
 * table, payam filters, print and the administrator's correct-and-remove
 * controls. This answers "what have I recorded, and what can I still fix",
 * which is a short list of cards in the order they were received.
 *
 * SCOPING IS THE SERVER'S. `GET /api/visits` puts
 * `fr.caseload_officer_id = $n` in the WHERE for a caseload principal, so
 * another officer's visits were never in the response. Nothing here filters
 * for authorisation and nothing should.
 *
 * THERE IS NO SEARCH, BECAUSE THE ROUTE HAS NONE. `visitFilterSchema` accepts
 * farmer, officer, payam, from, to, updated_since, limit and cursor -- no text
 * query. A search box here could only filter the page already fetched, which
 * would look like a search of everything and would quietly lie. Paging is the
 * route's cursor, not a page number this screen invents.
 */
type Phase = 'loading' | 'ready' | 'error';

const PAGE = 20;

export function OfficerVisits() {
  const { me } = usePreview();
  const myOfficerId = me?.scope?.kind === 'caseload' ? me.scope.officerId : null;
  const names = useVisitNames();

  const [visits, setVisits] = useState<readonly Visit[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [phase, setPhase] = useState<Phase>('loading');
  const [loadingMore, setLoadingMore] = useState(false);

  const load = useCallback(async () => {
    if (!LIVE_VISITS) {
      setPhase('error');
      return;
    }
    setPhase('loading');
    try {
      const page = await listVisits({ limit: PAGE });
      setVisits(page.visits);
      setCursor(page.cursor);
      setHasMore(page.hasMore);
      setPhase('ready');
    } catch {
      setPhase('error');
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const more = () => {
    if (!cursor) return;
    setLoadingMore(true);
    listVisits({ limit: PAGE, cursor })
      .then((page) => {
        setVisits((was) => [...was, ...page.visits]);
        setCursor(page.cursor);
        setHasMore(page.hasMore);
      })
      .catch(() => {
        /* The rows already shown remain true; the button stays. */
      })
      .finally(() => setLoadingMore(false));
  };

  return (
    <div className={styles.page}>
      <header className={styles.head}>
        <h1 className={styles.title}>My visits</h1>
        <p className={styles.count}>
          {phase === 'ready'
            ? `${visits.length}${hasMore ? '+' : ''} recorded`
            : 'Visits you have recorded'}
        </p>
      </header>

      {/*
        A visit needs a farmer, and the route takes it from the path. Choosing
        one is choosing from the caseload, which the farmers screen already
        does -- so this points there rather than rebuilding that list.
      */}
      <ButtonLink href="/farmers" className={styles.record}>
        + Record a visit
      </ButtonLink>

      {phase === 'loading' ? (
        <div className={styles.skeleton} aria-busy="true" aria-label="Loading your visits" />
      ) : null}

      {phase === 'error' ? (
        <UnavailableState title="Your visits could not be loaded">
          {LIVE_VISITS
            ? 'The list could not be read just now. Nothing has changed.'
            : 'This deployment is running on preview data, so no visits are read.'}
        </UnavailableState>
      ) : null}

      {phase === 'ready' && visits.length === 0 ? (
        <UnavailableState title="No visits recorded yet">
          Open a farmer on your caseload and record the first one.
        </UnavailableState>
      ) : null}

      {phase === 'ready' && visits.length > 0 ? (
        <ul className={styles.list}>
          {visits.map((visit) => {
            const window = correctionState(visit, myOfficerId);
            return (
              <li key={visit.id}>
                <Link href={`/visits/${visit.id}`} className={styles.card}>
                  <span className={styles.cardTop}>
                    <span className={styles.cardName} dir="auto">
                      {names.farmer(visit.farmer_id)}
                    </span>
                    <span className={styles.cardDate}>{formatDate(visit.visited_at)}</span>
                  </span>
                  {visit.topics.length > 0 ? (
                    <span className={styles.cardTopics}>
                      {visit.topics.map((t) => VISIT_TOPIC_LABELS[t] ?? t).join(' · ')}
                    </span>
                  ) : null}
                  <span className={styles.cardAdvice}>{visit.advice}</span>
                  <span className={styles.cardFoot}>
                    {window.canCorrect ? (
                      <span className={styles.correctable}>Can still be corrected</span>
                    ) : null}
                    {visit.attachments.length > 0 ? (
                      <span className={styles.attachCount}>
                        {visit.attachments.length}{' '}
                        {visit.attachments.length === 1 ? 'attachment' : 'attachments'}
                      </span>
                    ) : null}
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      ) : null}

      {phase === 'ready' && hasMore ? (
        <Button variant="secondary" className={styles.more} onClick={more} disabled={loadingMore}>
          {loadingMore ? 'Loading…' : 'Show more'}
        </Button>
      ) : null}
    </div>
  );
}
