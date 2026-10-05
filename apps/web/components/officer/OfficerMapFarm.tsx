'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';

import type { Crop } from '@agri-erp/shared';

import { Button, ButtonLink } from '@/components/ui';
import { UnavailableState } from '@/components/ui/data';
import { getFarmer, LIVE_FARMERS } from '@/lib/farmers/api';
import type { Farmer } from '@/lib/fixtures/farmers';
import { createFarm, declareCrops, LIVE_FARMS, type FarmWithCrops } from '@/lib/farms/api';
import { CROP_LABELS } from '@/lib/format';
import {
  buildCrops,
  buildFarm,
  FARM_CROPS,
  seasonOptions,
  toggleCrop,
  type WalkPoint,
} from '@/lib/officer/farm-mapping';
import { classify } from '@/lib/officer/recovery';

import { BoundaryWalk } from './BoundaryWalk';
import styles from './officer-farms.module.css';

/**
 * MAPPING A NEW FARM.
 *
 * CREATING A FARM IS MAPPING IT. `createFarmSchema` requires the first
 * boundary in the same body, so there is no draft farm, no empty farm and no
 * "add the boundary later". Nothing is saved until the walk is closed; what is
 * held until then lives in memory and is lost if the screen is left, which is
 * honest — offline capture is the Android application's job and is not built.
 *
 * THE FARMER IS THE URL'S. `POST /api/farmers/:id/farms` takes it from the
 * path and `loadVisible` answers 404 outside the caseload before the handler
 * runs, so there is no farmer field to tamper with and no list to choose from.
 *
 * CROPS COME SECOND, because `PUT /api/farms/:id/crops` needs a farm that
 * already exists.
 */
type Phase = 'loading' | 'ready' | 'notfound' | 'error';

export function OfficerMapFarm({ farmerId }: { farmerId: string }) {
  const [farmer, setFarmer] = useState<Farmer | null>(null);
  const [phase, setPhase] = useState<Phase>('loading');
  const [season, setSeason] = useState(() => seasonOptions()[0] ?? '');
  const [saving, setSaving] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const [saved, setSaved] = useState<FarmWithCrops | null>(null);

  useEffect(() => {
    if (!LIVE_FARMERS) {
      setPhase('error');
      return;
    }
    let on = true;
    getFarmer(farmerId)
      .then((row) => {
        if (!on) return;
        setFarmer(row);
        setPhase('ready');
      })
      .catch((e: { status?: number }) => on && setPhase(e?.status === 404 ? 'notfound' : 'error'));
    return () => {
      on = false;
    };
  }, [farmerId]);

  if (phase === 'loading') {
    return (
      <div className={styles.page}>
        <div className={styles.skeleton} aria-busy="true" aria-label="Loading the farmer" />
      </div>
    );
  }

  if (phase === 'notfound') {
    return (
      <div className={styles.page}>
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
        <UnavailableState title="This farmer could not be loaded">
          {LIVE_FARMERS
            ? 'The record could not be read just now. Nothing has changed.'
            : 'This deployment is running on preview data, so no farmer is read.'}
        </UnavailableState>
      </div>
    );
  }

  if (saved) return <Mapped farm={saved} farmer={farmer} season={season} />;

  const save = (points: readonly WalkPoint[], chosen: string) => {
    setFailure(null);
    if (!LIVE_FARMS) {
      setFailure('This deployment is running on preview data, so nothing was sent.');
      return;
    }
    setSaving(true);
    createFarm(
      farmer.id,
      buildFarm(
        points,
        chosen,
        { farmId: crypto.randomUUID(), boundaryId: crypto.randomUUID() },
        null,
      ),
    )
      .then(setSaved)
      .catch((error: unknown) => setFailure(classify(error).explanation))
      .finally(() => setSaving(false));
  };

  return (
    <div className={styles.page}>
      <Link href={`/farmers/${farmer.id}`} className={styles.back}>
        ← Back to farmer
      </Link>
      <h1 className={styles.title}>Map a farm</h1>
      <p className={styles.sub} dir="auto">
        {farmer.given_name} {farmer.family_name} ·{' '}
        <span className="mono">{farmer.farmer_number}</span>
      </p>

      <BoundaryWalk
        season={season}
        onSeasonChange={setSeason}
        seasonHint="Which season this mapping is for."
        saveLabel="Close boundary and save farm"
        saving={saving}
        failure={failure}
        onSave={save}
      />

      <p className={styles.note}>
        Crops are declared after the farm is saved. Nothing is kept on this phone — save while you
        have a signal.
      </p>
    </div>
  );
}

/**
 * After saving: the SERVER'S figures, then crops.
 *
 * The area and grade here are the ones PostGIS computed and stored, not the
 * estimate from the walk. When a figure is absent it is SAID to be absent —
 * an unmapped or un-returned area is never shown as zero.
 */
function Mapped({ farm, farmer, season }: { farm: FarmWithCrops; farmer: Farmer; season: string }) {
  const [crops, setCrops] = useState<readonly Crop[]>([]);
  const [saving, setSaving] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const save = () => {
    setError(null);
    setSaving(true);
    declareCrops(farm.farm.id, buildCrops(season, crops))
      .then(() => setDone(true))
      .catch((e: unknown) => setError(classify(e).explanation))
      .finally(() => setSaving(false));
  };

  return (
    <div className={styles.page}>
      <div className={styles.done}>
        <p className={styles.doneLabel}>Farm mapped</p>
        <p className={styles.area}>
          {farm.farm.area_ha === undefined ? (
            <span className={styles.none}>area not returned</span>
          ) : (
            `${farm.farm.area_ha} ha`
          )}
        </p>
        <p className={styles.doneName} dir="auto">
          {farmer.given_name} {farmer.family_name} · <span className="mono">{season}</span>
        </p>
        <p className={styles.note}>
          {farm.farm.point_count === undefined
            ? 'Recorded.'
            : `${farm.farm.point_count} corners, graded ${farm.farm.accuracy_flag}.`}
        </p>
      </div>

      <section className={styles.walk} aria-labelledby="crops-h">
        <h2 id="crops-h" className={styles.blockHead}>
          Crops this season
        </h2>
        <p className={styles.note}>
          What is growing on this plot in <span className="mono">{season}</span>. Leave all unticked
          if nothing is planted — that is a declaration too.
        </p>
        <div className={styles.crops} role="group" aria-labelledby="crops-h">
          {FARM_CROPS.map((crop) => {
            const on = crops.includes(crop);
            return (
              <button
                key={crop}
                type="button"
                className={`${styles.crop} ${on ? styles.cropOn : ''}`}
                aria-pressed={on}
                onClick={() => setCrops(toggleCrop(crops, crop))}
              >
                {CROP_LABELS[crop]}
              </button>
            );
          })}
        </div>
        {error ? (
          <p className={styles.fieldError} role="alert">
            {error}
          </p>
        ) : null}
        <Button className={styles.wide} onClick={save} disabled={saving || done}>
          {done ? 'Crops saved' : saving ? 'Saving…' : 'Save crops'}
        </Button>
      </section>

      <div className={styles.doneActions}>
        <ButtonLink href={`/farmers/${farmer.id}`} className={styles.wide}>
          Back to farmer
        </ButtonLink>
      </div>
    </div>
  );
}
