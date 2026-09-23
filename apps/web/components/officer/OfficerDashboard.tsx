'use client';

import { useEffect, useMemo, useState } from 'react';

import { ButtonLink, Card, Stamp } from '@/components/ui';
import { LoadingState, UnavailableState } from '@/components/ui/data';
import { IconFarmers, IconVisits, IconPlus, IconMap } from '@/components/ui/icons';
import { BuyerRequests } from './BuyerRequests';
import { LIVE_FARMERS, listFarmers } from '@/lib/farmers/api';
import { LIVE_VISITS, listVisits } from '@/lib/visits/api';
import type { Visit } from '@/lib/visits/api';
import type { Farmer } from '@/lib/fixtures/farmers';
import { usePreview } from '@/lib/preview';
import { formatDate } from '@/lib/format';
import {
  caseloadCounts,
  fetchWindow,
  needingAttention,
  visitsToday,
  type AttentionRow,
} from '@/lib/officer/dashboard';

import styles from './officer-dashboard.module.css';

/**
 * THE EXTENSION OFFICER'S HOME, AND IT ANSWERS ONE QUESTION.
 *
 * "What do I need to do today?" -- not "what is happening across the
 * programme", which is the administrator's screen and a different shape. So
 * there are no trends, no breakdowns by state, no progress towards a decision
 * this role does not make. There is today's work, the people waiting on it,
 * and four ways to start.
 *
 * BUILT FOR A PHONE IN SUNLIGHT. Cards rather than a data grid; 56px targets
 * rather than 32; one column until the tablet breakpoint; the numbers large
 * enough to read at arm's length; and the primary action reachable by thumb.
 * The tokens are The Register's own -- this is still CORWADO's product, dressed
 * for a field rather than a desk.
 *
 * EVERY FIGURE IS SERVER-SCOPED AND NONE IS INVENTED.
 *
 *   - Caseload: `GET /api/farmers`, which an officer receives already narrowed
 *     to `caseload_officer_id`. No filter here can widen it.
 *   - Today: `GET /api/visits?from&to`, the same scoping, windowed to the
 *     officer's local day.
 *   - Identity and payam: `GET /api/me`, which carries
 *     `scope: { kind: 'caseload', officerId, payamId }`.
 *
 * AND WHAT IS ABSENT IS ABSENT ON PURPOSE. No "due today" -- the backend has no
 * concept of a visit being due, because a visit is recorded after it happens.
 * No activity feed -- `GET /api/audit` is administrator-only. No verify,
 * reject, merge or reassign anywhere on this screen: those belong to a
 * supervisor, and offering them here would be offering a door that answers 403.
 * The one decision an officer owns over a waiting farmer is resubmitting a
 * rejected registration, and that is the only action this screen offers.
 */

type Load<T> = { state: 'loading' } | { state: 'ready'; data: T } | { state: 'error'; why: string };

export function OfficerDashboard() {
  const { me, role } = usePreview();
  const [farmers, setFarmers] = useState<Load<{ rows: Farmer[]; complete: boolean }>>({
    state: 'loading',
  });
  const [visits, setVisits] = useState<Load<{ rows: Visit[]; complete: boolean }>>({
    state: 'loading',
  });
  const now = useMemo(() => new Date(), []);

  useEffect(() => {
    if (!LIVE_FARMERS) {
      setFarmers({ state: 'error', why: 'preview' });
      return;
    }
    let on = true;
    listFarmers({ limit: 200 })
      .then(
        (page) =>
          on &&
          setFarmers({
            state: 'ready',
            // hasMore means this is the first PAGE, not the caseload. The
            // screen prints a floor and says so rather than a wrong total.
            data: { rows: page.farmers, complete: !page.hasMore },
          }),
      )
      .catch(() => on && setFarmers({ state: 'error', why: 'unreachable' }));
    return () => {
      on = false;
    };
  }, []);

  useEffect(() => {
    if (!LIVE_VISITS) {
      setVisits({ state: 'error', why: 'preview' });
      return;
    }
    let on = true;
    // A day either side: the route filters received_at and this counts
    // visited_at, and those part company the moment a visit syncs late.
    const { from, to } = fetchWindow(now);
    listVisits({ from, to, limit: 100 })
      .then(
        (page) =>
          on && setVisits({ state: 'ready', data: { rows: page.visits, complete: !page.hasMore } }),
      )
      .catch(() => on && setVisits({ state: 'error', why: 'unreachable' }));
    return () => {
      on = false;
    };
  }, [now]);

  const counts =
    farmers.state === 'ready' ? caseloadCounts(farmers.data.rows, farmers.data.complete) : null;
  const attention = farmers.state === 'ready' ? needingAttention(farmers.data.rows) : [];
  const today =
    visits.state === 'ready' ? visitsToday(visits.data.rows, now, visits.data.complete) : null;
  const payamId = me?.scope?.kind === 'caseload' ? me.scope.payamId : null;

  return (
    <div className={styles.page}>
      {/* A. Who you are and where — compact, because it is context, not content. */}
      <header className={styles.head}>
        {/* Not ROLE_LABELS: that map covers staff accounts, and an officer is
            not one -- they sign in with a phone number against the officer
            table. Their own word for the job. */}
        <p className={styles.eyebrow}>{role === 'officer' ? 'Extension officer' : role}</p>
        <h1 className={styles.name}>{me?.name ?? 'Field desk'}</h1>
        {payamId ? (
          <p className={styles.scope}>
            Payam <span className="mono">{payamId}</span> · your caseload
          </p>
        ) : (
          <p className={styles.scope}>Your caseload</p>
        )}
      </header>

      {/* B. Today. The only two numbers a field day turns on. */}
      <section aria-labelledby="today-h" className={styles.section}>
        <h2 id="today-h" className={styles.h2}>
          Today
        </h2>
        {visits.state === 'loading' ? (
          <LoadingState rows={1} label="Reading today’s visits" />
        ) : today ? (
          <div className={styles.todayCard}>
            <div className={styles.todayFigures}>
              <p className={styles.bigStat}>
                <span className={styles.bigNumber}>
                  {today.complete ? today.count : `${today.count}+`}
                </span>
                <span className={styles.bigLabel}>
                  {today.count === 1 ? 'visit recorded' : 'visits recorded'}
                </span>
              </p>
              <p className={styles.bigStat}>
                <span className={styles.bigNumber}>
                  {today.complete ? today.farmersSeen : `${today.farmersSeen}+`}
                </span>
                <span className={styles.bigLabel}>
                  {today.farmersSeen === 1 ? 'farmer seen' : 'farmers seen'}
                </span>
              </p>
            </div>
            {today.count === 0 ? (
              <p className={styles.todayNone}>
                Nothing recorded yet today. Record a visit when you have made one.
              </p>
            ) : null}
            {!today.complete ? (
              <p className={styles.floor}>
                More visits than one page holds — these are at least this many.
              </p>
            ) : null}
          </div>
        ) : (
          <UnavailableState title="Today’s visits are not available">
            {visits.state === 'error' && visits.why === 'preview'
              ? 'This deployment is running on preview data, so no visit figures are read.'
              : 'The visit list could not be read just now. This is not a day with no visits — nothing was counted.'}
          </UnavailableState>
        )}
        <p className={styles.note}>
          Counted by when the visit happened, not when it reached the server.
        </p>
      </section>

      {/* C. Start something. The four things an officer actually does. */}
      <section aria-labelledby="do-h" className={styles.section}>
        <h2 id="do-h" className={styles.h2}>
          Start
        </h2>
        <div className={styles.actions}>
          <ButtonLink href="/farmers/new" className={styles.action}>
            <IconPlus size={22} /> Register a farmer
          </ButtonLink>
          <ButtonLink href="/visits" variant="secondary" className={styles.action}>
            <IconVisits size={22} /> Record a visit
          </ButtonLink>
          <ButtonLink href="/farmers" variant="secondary" className={styles.action}>
            <IconFarmers size={22} /> My farmers
          </ButtonLink>
          <ButtonLink href="/farmers?status=verified" variant="secondary" className={styles.action}>
            <IconMap size={22} /> Farms to map
          </ButtonLink>
        </div>
        <p className={styles.note}>
          A farm is mapped from the farmer who owns it — open the farmer, then add the boundary.
        </p>
      </section>

      {/* D. Who is waiting, and what you can actually do about it. */}
      <section aria-labelledby="attention-h" className={styles.section}>
        <h2 id="attention-h" className={styles.h2}>
          Needs attention
        </h2>
        {farmers.state === 'loading' ? (
          <LoadingState rows={3} label="Reading your caseload" />
        ) : farmers.state === 'error' ? (
          <UnavailableState title="Your caseload could not be read">
            {farmers.why === 'preview'
              ? 'This deployment is running on preview data, so no caseload is read.'
              : 'The farmer list could not be read just now. Nothing is missing from your caseload — it was not counted.'}
          </UnavailableState>
        ) : attention.length === 0 ? (
          <Card>
            <p className={styles.clear}>
              Nothing is waiting on you. {counts?.verified ?? 0} of {counts?.total ?? 0} verified.
            </p>
          </Card>
        ) : (
          <ul className={styles.rows}>
            {attention.map((row) => (
              <AttentionCard key={row.farmer.id} row={row} />
            ))}
          </ul>
        )}
      </section>

      {/* E. The caseload as a whole, kept below the day's work. */}
      {counts ? (
        <section aria-labelledby="caseload-h" className={`${styles.section} ${styles.secondary}`}>
          <h2 id="caseload-h" className={styles.h2}>
            Your caseload
          </h2>
          <dl className={styles.counts}>
            <div className={styles.count}>
              <dt>Farmers</dt>
              <dd>{counts.total}</dd>
            </div>
            <div className={styles.count}>
              <dt>Verified</dt>
              <dd>{counts.verified}</dd>
            </div>
            <div className={styles.count}>
              <dt>Pending</dt>
              <dd>{counts.pending}</dd>
            </div>
            <div className={styles.count}>
              <dt>Rejected</dt>
              <dd>{counts.rejected}</dd>
            </div>
          </dl>
          <p className={styles.note}>
            {counts.complete
              ? `${counts.verified} of your ${counts.total} farmers are verified.`
              : `The first ${counts.total} of your caseload — more than one page holds.`}{' '}
            Verifying is a supervisor’s decision: a pending farmer is with them, not with you.
          </p>
        </section>
      ) : null}

      {/*
        CARRIED OVER FROM THE OLD FIELD DESK, NOT REBUILT. Buyer contact
        requests are the officer's: a buyer asks to reach a farmer, and the
        officer introduces them or does not. It is fieldwork, so it stays -- but
        below the day's work, because a caseload comes first. Replacing this
        screen without it would have removed a capability the officer had
        yesterday, which is not a redesign, it is a loss.
      */}
      {farmers.state === 'ready' ? (
        <section aria-labelledby="buyers-h" className={`${styles.section} ${styles.secondary}`}>
          <h2 id="buyers-h" className={styles.h2}>
            Buyer requests
          </h2>
          <BuyerRequests caseload={farmers.data.rows} officerId={me?.id ?? null} />
        </section>
      ) : null}

      <p className={styles.footnote}>
        This is the web desk. Working without a signal is the Android application’s job, and it is
        not built yet.
      </p>
    </div>
  );
}

function AttentionCard({ row }: { row: AttentionRow }) {
  const { farmer, group, officerCanAct } = row;
  return (
    <li>
      <Card className={styles.attnCard}>
        <div className={styles.attnTop}>
          <div className={styles.attnWho}>
            <span className={styles.attnName} dir="auto">
              {farmer.given_name} {farmer.family_name}
            </span>
            <span className={styles.attnMeta}>
              <span className="mono">{farmer.farmer_number}</span> · {formatDate(farmer.created_at)}
            </span>
          </div>
          <Stamp kind={group === 'rejected' ? 'rejected' : 'pending'}>
            {group === 'rejected' ? 'Rejected' : 'Pending'}
          </Stamp>
        </div>
        {officerCanAct ? (
          <ButtonLink href={`/farmers/${farmer.id}`} className={styles.attnAction}>
            Correct and resubmit
          </ButtonLink>
        ) : (
          <p className={styles.attnWait}>With a supervisor. Nothing for you to do yet.</p>
        )}
      </Card>
    </li>
  );
}
