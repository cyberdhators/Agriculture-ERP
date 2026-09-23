'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';

import { REJECTION_REASONS, type RejectionReason } from '@agri-erp/shared';

import { Button, ButtonLink, Stamp } from '@/components/ui';
import { UnavailableState } from '@/components/ui/data';
import { LIVE_FARMERS, getFarmer } from '@/lib/farmers/api';
import { LIVE_VERIFICATION, resubmitFarmer } from '@/lib/farmers/verification';
import { LIVE_FARMS, listFarmerFarms, type FarmWithCrops } from '@/lib/farms/api';
import { LIVE_VISITS, listFarmerVisits, type Visit } from '@/lib/visits/api';
import { VISIT_TOPIC_LABELS } from '@/lib/visits/fixtures';
import type { Farmer } from '@/lib/fixtures/farmers';
import {
  identityRows,
  officerActions,
  rejectionOf,
  statusOf,
  wasToldNoNationalId,
} from '@/lib/officer/farmer-detail';
import { formatDate, formatPhone } from '@/lib/format';

import styles from './officer-farmer-detail.module.css';

/**
 * ONE FARMER, AS THE OFFICER WHO WORKS THEM NEEDS THEM.
 *
 * Three questions: who is this, what is their status, and what can I do next.
 * The administrator's dossier answers a fourth -- what shall I decide about
 * them -- and carries verify, reject, merge, reassign and remove for it. None
 * of those is here, and none is disabled either: a greyed button still tells
 * an officer the system could do it for them if they asked nicely.
 *
 * AN OUTSIDE-CASELOAD FARMER IS A 404, AND THAT IS THE SERVER'S DOING.
 * `GET /api/farmers/:id` runs `loadVisible`, which puts the caseload clause in
 * the WHERE before the row is read, so a farmer belonging to another officer
 * comes back exactly as a farmer who never existed does. Nothing here fetches
 * broadly and narrows afterwards; there is no ownership check in this file,
 * because the one that matters already happened.
 *
 * THE NATIONAL ID IS SHOWN WHOLE. C-5.8 gives it to the officer who works the
 * farmer. Masking it to `••••1902` would tell them an identity document exists
 * while withholding the thing they need to check it against a card in their
 * hand -- the worst of both.
 */

const STATUS_WORD: Record<string, string> = {
  pending: 'Pending verification',
  verified: 'Verified',
  rejected: 'Rejected',
  merged: 'Merged into another record',
};

/** C-6.3's fixed vocabulary. The code carries the meaning; nothing is invented. */
const REASON_LABEL: Record<RejectionReason, string> = {
  duplicate: 'Duplicate of another farmer',
  wrong_location: 'Wrong location',
  incomplete: 'Incomplete record',
  not_a_farmer: 'Not a farmer',
  consent_missing: 'Consent missing',
  other: 'Other',
};

const reasonWord = (code: string | null): string | null => {
  if (!code) return null;
  return (REJECTION_REASONS as readonly string[]).includes(code)
    ? REASON_LABEL[code as RejectionReason]
    : code.replace(/_/g, ' ');
};

type Phase = 'loading' | 'ready' | 'notfound' | 'error';

export function OfficerFarmerDetail({ id }: { id: string }) {
  const [farmer, setFarmer] = useState<Farmer | null>(null);
  const [phase, setPhase] = useState<Phase>('loading');
  const [why, setWhy] = useState<string | null>(null);
  const [farms, setFarms] = useState<FarmWithCrops[] | null>(null);
  const [visits, setVisits] = useState<Visit[] | null>(null);
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!LIVE_FARMERS) {
      setPhase('error');
      setWhy('preview');
      return;
    }
    setPhase('loading');
    try {
      setFarmer(await getFarmer(id));
      setPhase('ready');
    } catch (failure) {
      // 404 is the answer for "not yours" and "not there" alike, and the screen
      // must not try to tell them apart either.
      const status = (failure as { status?: number }).status;
      setPhase(status === 404 ? 'notfound' : 'error');
      setWhy(status === 404 ? null : 'unreachable');
    }
  }, [id]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (phase !== 'ready' || !LIVE_FARMS) return;
    let on = true;
    listFarmerFarms(id)
      .then((rows) => on && setFarms(rows))
      .catch(() => on && setFarms(null));
    return () => {
      on = false;
    };
  }, [phase, id]);

  useEffect(() => {
    if (phase !== 'ready' || !LIVE_VISITS) return;
    let on = true;
    listFarmerVisits(id, { limit: 5 })
      .then((page) => on && setVisits(page.visits))
      .catch(() => on && setVisits(null));
    return () => {
      on = false;
    };
  }, [phase, id]);

  if (phase === 'loading') {
    return (
      <div className={styles.page}>
        <BackLink />
        <div className={styles.skeletonHead} aria-busy="true" aria-label="Loading the farmer" />
        <div className={styles.skeletonBlock} />
      </div>
    );
  }

  if (phase === 'notfound') {
    return (
      <div className={styles.page}>
        <BackLink />
        <UnavailableState title="This farmer is not on your caseload">
          Either there is no such record, or it belongs to another officer. Both look the same from
          here, and that is deliberate.
        </UnavailableState>
      </div>
    );
  }

  if (phase === 'error' || !farmer) {
    return (
      <div className={styles.page}>
        <BackLink />
        <UnavailableState title="This farmer could not be loaded">
          {why === 'preview'
            ? 'This deployment is running on preview data, so no farmer is read.'
            : 'The record could not be read just now. Nothing has changed — it was not fetched. Try again in a moment.'}
        </UnavailableState>
        <Button variant="secondary" className={styles.retry} onClick={() => void load()}>
          Try again
        </Button>
      </div>
    );
  }

  const status = statusOf(farmer);
  const actions = officerActions(farmer);
  const rejection = rejectionOf(farmer);
  const rows = identityRows(farmer);

  return (
    <div className={styles.page}>
      <BackLink />

      <header className={styles.head}>
        <h1 className={styles.name} dir="auto">
          {farmer.given_name} {farmer.family_name}
        </h1>
        <div className={styles.statusRow}>
          <Stamp kind={status === 'merged' ? 'merged' : status}>
            {STATUS_WORD[status] ?? status}
          </Stamp>
        </div>
      </header>

      {/* Rejected first: it is the only thing here the officer can act on. */}
      {rejection ? (
        <section className={styles.rejection} aria-labelledby="rej-h">
          <h2 id="rej-h" className={styles.rejectionTitle}>
            A supervisor rejected this registration
          </h2>
          {reasonWord(rejection.reasonCode) ? (
            <p className={styles.rejectionReason}>{reasonWord(rejection.reasonCode)}</p>
          ) : null}
          {rejection.note ? <p className={styles.rejectionNote}>{rejection.note}</p> : null}
          {rejection.decidedAt ? (
            <p className={styles.rejectionWhen}>Decided {formatDate(rejection.decidedAt)}</p>
          ) : null}
        </section>
      ) : null}

      {actions.canResubmit || actions.canEdit ? (
        <div className={styles.actions}>
          {actions.canResubmit ? (
            <Button
              className={styles.primaryAction}
              disabled={sending || !LIVE_VERIFICATION}
              onClick={() => {
                setSending(true);
                setSendError(null);
                resubmitFarmer(farmer.id)
                  .then(() => load())
                  .catch(() =>
                    setSendError('The record could not be resubmitted just now. Nothing changed.'),
                  )
                  .finally(() => setSending(false));
              }}
            >
              {sending ? 'Sending…' : 'Correct and resubmit'}
            </Button>
          ) : null}
          {actions.canEdit ? (
            <ButtonLink
              href={`/farmers/${farmer.id}/edit`}
              variant="secondary"
              className={styles.secondaryAction}
            >
              Edit details
            </ButtonLink>
          ) : null}
        </div>
      ) : null}

      {sendError ? <p className={styles.actionError}>{sendError}</p> : null}
      {actions.canResubmit && !LIVE_VERIFICATION ? (
        <p className={styles.actionNote}>
          Resubmission is not connected on this deployment, so the button will not send.
        </p>
      ) : null}

      <section aria-labelledby="who-h" className={styles.section}>
        <h2 id="who-h" className={styles.h2}>
          Details
        </h2>
        <dl className={styles.rows}>
          {rows.map((row) => (
            <div key={row.key} className={styles.row}>
              <dt>{row.label}</dt>
              <dd className={row.mono ? 'mono' : undefined}>
                {row.key === 'phone' ? formatPhone(row.value) : row.value}
              </dd>
            </div>
          ))}
        </dl>
        {wasToldNoNationalId(farmer) ? (
          <p className={styles.note}>No national ID was recorded for this farmer.</p>
        ) : null}
      </section>

      {/*
        FARMS: from GET /api/farmers/:id/farms, which accepts every role. The
        administrator's map reads GET /api/farms/geojson and is admin and
        supervisor only, so it is not here and not linked to. Boundary figures
        are shown only where the route sent them -- an absent area is absent,
        never a zero (C-7.8).
      */}
      {farms && farms.length > 0 ? (
        <section aria-labelledby="farms-h" className={styles.section}>
          <h2 id="farms-h" className={styles.h2}>
            Farms
          </h2>
          <ul className={styles.plainList}>
            {farms.map(({ farm, crops }) => (
              <li key={farm.id} className={styles.miniCard}>
                <span className={styles.miniTitle}>{farm.season}</span>
                <span className={styles.miniMeta}>
                  {farm.area_ha === undefined ? null : <>{farm.area_ha.toFixed(2)} ha · </>}
                  Mapped {formatDate(farm.mapped_at)}
                </span>
                {crops.length > 0 ? (
                  <span className={styles.miniMeta}>{crops.join(', ')}</span>
                ) : null}
                {/*
                  Re-mapping walks the boundary again for a season. It adds a
                  boundary and supersedes, never edits in place, so the earlier
                  measurement is kept (C-7.5).
                */}
                <span className={styles.miniActions}>
                  <Link href={`/farms/${farm.id}`} className={styles.miniLink}>
                    Open farm
                  </Link>
                  <Link href={`/farms/${farm.id}/remap`} className={styles.miniLink}>
                    Re-map
                  </Link>
                </span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {/*
        MAP A FARM. `POST /api/farmers/:id/farms` takes the farmer from the
        path and refuses anyone outside the caseload with a 404, so this simply
        carries THIS farmer's id. Offered even when no farm exists yet — that
        is exactly when it is most needed.
      */}
      <ButtonLink href={`/farmers/${farmer.id}/farms/new`} className={styles.recordVisit}>
        Map a farm
      </ButtonLink>

      {/*
        RECORD A VISIT. The farmer is already known and already authorised --
        this passes THAT id to `/farmers/:id/visits/new`, which posts to
        `POST /api/farmers/:id/visits`, where `loadVisible` answers 404 for a
        farmer outside the caseload. The action is offered whether or not there
        is any history to show, because the first visit is the one most worth
        recording.
      */}
      <ButtonLink href={`/farmers/${farmer.id}/visits/new`} className={styles.recordVisit}>
        Record visit
      </ButtonLink>

      {/*
        VISITS: GET /api/farmers/:id/visits, all four roles. A short history so
        the officer knows what was last said, not the visits screen rebuilt.
      */}
      {visits && visits.length > 0 ? (
        <section aria-labelledby="visits-h" className={styles.section}>
          <h2 id="visits-h" className={styles.h2}>
            Recent visits
          </h2>
          <ul className={styles.plainList}>
            {visits.map((visit) => (
              <li key={visit.id} className={styles.miniCard}>
                <span className={styles.miniTitle}>{formatDate(visit.visited_at)}</span>
                {visit.topics.length > 0 ? (
                  <span className={styles.miniMeta}>
                    {visit.topics.map((t) => VISIT_TOPIC_LABELS[t] ?? t).join(', ')}
                  </span>
                ) : null}
                <span className={styles.miniAdvice}>{visit.advice}</span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}

function BackLink() {
  return (
    <Link href="/farmers" className={styles.back}>
      ← My farmers
    </Link>
  );
}
