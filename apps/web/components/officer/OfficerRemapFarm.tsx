'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';

import { ButtonLink } from '@/components/ui';
import { UnavailableState } from '@/components/ui/data';
import {
  addBoundary,
  getFarm,
  listFarmBoundaries,
  LIVE_FARMS,
  type AddedBoundary,
  type FarmWithCrops,
} from '@/lib/farms/api';
import { buildBoundary, seasonOptions, type WalkPoint } from '@/lib/officer/farm-mapping';
import { classify } from '@/lib/officer/recovery';
import { formatDate } from '@/lib/format';

import { BoundaryWalk } from './BoundaryWalk';
import styles from './officer-farms.module.css';

/**
 * RE-MAPPING A FARM.
 *
 * NOT AN EDIT, AND NOT A PATCH. `POST /api/farms/:id/boundaries` INSERTS a new
 * boundary which becomes current for its season; the one it replaces is kept
 * with `is_current` false. So what the land was measured to be last season, or
 * last week, is never overwritten -- the history is the point (C-7.5). There is
 * no route that edits a boundary's geometry in place, and this screen offers
 * none.
 *
 * ONE CURRENT BOUNDARY PER SEASON. Re-walking a season the farm already has
 * supersedes that season's boundary; choosing a season it has never had simply
 * adds one. A partial unique index is the last word on that, so two officers
 * saving at once cannot both end current.
 *
 * SCOPE IS THE SERVER'S. `loadVisibleFarm` puts the caseload clause in the
 * WHERE, so another officer's farm is a 404 here exactly as everywhere else.
 */
type Phase = 'loading' | 'ready' | 'notfound' | 'error';

interface HistoryRow {
  id: string;
  season: string;
  area_ha: number;
  grade: string;
  point_count: number;
  mapped_at: string;
  is_current: boolean;
}

export function OfficerRemapFarm({ farmId }: { farmId: string }) {
  const [farm, setFarm] = useState<FarmWithCrops | null>(null);
  const [history, setHistory] = useState<readonly HistoryRow[]>([]);
  const [phase, setPhase] = useState<Phase>('loading');
  const [season, setSeason] = useState(() => seasonOptions()[0] ?? '');
  const [saving, setSaving] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const [added, setAdded] = useState<AddedBoundary | null>(null);

  useEffect(() => {
    if (!LIVE_FARMS) {
      setPhase('error');
      return;
    }
    let on = true;
    getFarm(farmId)
      .then(async (row) => {
        if (!on) return;
        setFarm(row);
        setPhase('ready');
        const rows = await listFarmBoundaries(farmId).catch(() => []);
        if (on) setHistory(rows as HistoryRow[]);
      })
      .catch((e: { status?: number }) => on && setPhase(e?.status === 404 ? 'notfound' : 'error'));
    return () => {
      on = false;
    };
  }, [farmId]);

  if (phase === 'loading') {
    return (
      <div className={styles.page}>
        <div className={styles.skeleton} aria-busy="true" aria-label="Loading the farm" />
      </div>
    );
  }

  if (phase === 'notfound') {
    return (
      <div className={styles.page}>
        <UnavailableState title="This farm is not on your caseload">
          Either there is no such farm, or it belongs to another officer&apos;s farmer. Both look
          the same from here, and that is deliberate.
        </UnavailableState>
      </div>
    );
  }

  if (phase === 'error' || !farm) {
    return (
      <div className={styles.page}>
        <UnavailableState title="This farm could not be loaded">
          {LIVE_FARMS
            ? 'The farm could not be read just now. Nothing has changed.'
            : 'This deployment is running on preview data, so no farm is read.'}
        </UnavailableState>
      </div>
    );
  }

  if (added) {
    return (
      <div className={styles.page}>
        <div className={styles.done}>
          <p className={styles.doneLabel}>
            {added.superseded ? 'Boundary replaced' : 'Boundary added'}
          </p>
          <p className={styles.area}>{added.area_ha} ha</p>
          <p className={styles.doneName}>
            <span className="mono">{added.season}</span> · {added.point_count} corners, graded{' '}
            {added.grade}
          </p>
          <p className={styles.note}>
            {added.superseded
              ? 'The boundary it replaced is kept in this farm’s history.'
              : 'This season had no boundary before now.'}
          </p>
        </div>
        <div className={styles.doneActions}>
          <ButtonLink href={`/farmers/${farm.farm.farmer_id}`} className={styles.wide}>
            Back to farmer
          </ButtonLink>
        </div>
      </div>
    );
  }

  const save = (points: readonly WalkPoint[], chosen: string) => {
    setFailure(null);
    setSaving(true);
    addBoundary(farm.farm.id, buildBoundary(points, chosen, crypto.randomUUID()))
      .then(setAdded)
      .catch((error: unknown) => setFailure(classify(error).explanation))
      .finally(() => setSaving(false));
  };

  const replacing = history.find((row) => row.season === season && row.is_current);

  return (
    <div className={styles.page}>
      <Link href={`/farmers/${farm.farm.farmer_id}`} className={styles.back}>
        ← Back to farmer
      </Link>
      <h1 className={styles.title}>Re-map this farm</h1>
      <p className={styles.sub}>Walk the boundary again for a season.</p>

      {/* What this farm has been measured as, so the officer knows what they are
          about to supersede — and knows it is kept. */}
      {history.length > 0 ? (
        <section className={styles.walk} aria-labelledby="hist-h">
          <h2 id="hist-h" className={styles.blockHead}>
            Mapped so far
          </h2>
          <ul className={styles.list}>
            {history.map((row) => (
              <li key={row.id} className={styles.seasonRow}>
                <span className={styles.seasonName}>{row.season}</span>
                <span className={styles.seasonFacts}>
                  {row.area_ha} ha · {row.point_count} corners · {row.grade} ·{' '}
                  {formatDate(row.mapped_at)}
                </span>
                {!row.is_current ? <span className={styles.superseded}>superseded</span> : null}
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {replacing ? (
        <p className={styles.warn}>
          This farm already has a boundary for <span className="mono">{season}</span> of{' '}
          {replacing.area_ha} ha. Saving replaces it as the current one and keeps the old in the
          history.
        </p>
      ) : null}

      <BoundaryWalk
        season={season}
        onSeasonChange={setSeason}
        seasonHint="Which season this walk measures."
        saveLabel="Close boundary and save"
        saving={saving}
        failure={failure}
        onSave={save}
      />
    </div>
  );
}
