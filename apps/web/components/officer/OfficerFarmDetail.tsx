'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';

import type { Crop } from '@agri-erp/shared';

import { Boundary } from '@/components/farmers/Boundary';
import { Button, ButtonLink } from '@/components/ui';
import { UnavailableState } from '@/components/ui/data';
import { getFarmer, LIVE_FARMERS } from '@/lib/farmers/api';
import type { Farmer } from '@/lib/fixtures/farmers';
import {
  declareCrops,
  getFarmRecord,
  listFarmBoundaries,
  LIVE_FARMS,
  type FarmBoundaryRecord,
  type FarmRecord,
} from '@/lib/farms/api';
import { CROP_LABELS, formatDate } from '@/lib/format';
import {
  boundaryAsFarm,
  geometryOf,
  gradeFor,
  seasonBlocks,
  type SeasonBlock,
} from '@/lib/officer/farm-detail';
import { buildCrops, FARM_CROPS, toggleCrop } from '@/lib/officer/farm-mapping';
import { classify } from '@/lib/officer/recovery';

import styles from './officer-farms.module.css';

/**
 * A FARM, READ BACK AFTER THE WALK.
 *
 * TWO READS, BOTH OFFICER-SAFE, AND NO MORE THAN THAT.
 * `GET /api/farms/:id` gives the farm, its CURRENT boundary per season and its
 * crops; `GET /api/farms/:id/boundaries` gives every boundary, superseded ones
 * included. Both run `loadVisibleFarm`, which puts the caseload clause in the
 * WHERE, so a farm outside this officer's caseload is a 404 before any row is
 * read. Nothing here compares ownership and nothing here filters for
 * authorisation.
 *
 * `GET /api/farms/geojson` IS NOT USED AND MUST NOT BE. It is the one route
 * serving boundary coordinates across farms nationally, it is admin and
 * supervisor only, and the shape shown here comes from this farm's own rows.
 *
 * NOTHING IS RECALCULATED. The area, the corner count and the accuracy grade
 * are the server's, computed by PostGIS at insert. The walking screen's
 * estimate appears nowhere on this page.
 */
type Phase = 'loading' | 'ready' | 'notfound' | 'error';

export function OfficerFarmDetail({ farmId }: { farmId: string }) {
  const [record, setRecord] = useState<FarmRecord | null>(null);
  const [history, setHistory] = useState<readonly FarmBoundaryRecord[]>([]);
  const [farmer, setFarmer] = useState<Farmer | null>(null);
  const [phase, setPhase] = useState<Phase>('loading');

  const load = useCallback(async () => {
    if (!LIVE_FARMS) {
      setPhase('error');
      return;
    }
    setPhase('loading');
    try {
      const farm = await getFarmRecord(farmId);
      setRecord(farm);
      setPhase('ready');
      // Context for a farm already proved visible; neither failing should turn
      // a readable farm into an error.
      const [rows, who] = await Promise.all([
        listFarmBoundaries(farmId).catch(() => [] as FarmBoundaryRecord[]),
        LIVE_FARMERS ? getFarmer(farm.farmer_id).catch(() => null) : Promise.resolve(null),
      ]);
      setHistory(rows);
      setFarmer(who);
    } catch (failure) {
      setPhase((failure as { status?: number })?.status === 404 ? 'notfound' : 'error');
    }
  }, [farmId]);

  useEffect(() => {
    void load();
  }, [load]);

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

  if (phase === 'error' || !record) {
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

  const blocks = seasonBlocks(record, history);

  return (
    <div className={styles.page}>
      <Link href={`/farmers/${record.farmer_id}`} className={styles.back}>
        ← Back to farmer
      </Link>
      <h1 className={styles.title}>Farm</h1>
      <p className={styles.sub} dir="auto">
        {farmer ? (
          <>
            {farmer.given_name} {farmer.family_name} ·{' '}
            <span className="mono">{farmer.farmer_number}</span>
          </>
        ) : (
          <span className="mono">{record.payam_id}</span>
        )}
      </p>
      <p className={styles.sub}>
        First mapped for <span className="mono">{record.season}</span> ·{' '}
        {/* Optional AND nullable on the contract: stated, never fabricated. */}
        {record.captured_at === null
          ? `recorded ${formatDate(record.created_at)}`
          : `captured ${formatDate(record.captured_at)}`}
      </p>

      {blocks.map((block) => (
        <SeasonSection key={block.season} block={block} record={record} onSaved={load} />
      ))}

      <ButtonLink href={`/farms/${record.id}/remap`} className={styles.wide}>
        Re-map boundary
      </ButtonLink>
      <p className={styles.note}>
        Re-mapping walks the boundary again for a season. The boundary it replaces is kept in this
        farm&apos;s history, never removed.
      </p>
    </div>
  );
}

/** One season: its current shape and figures, its crops, and what it replaced. */
function SeasonSection({
  block,
  record,
  onSaved,
}: {
  block: SeasonBlock;
  record: FarmRecord;
  onSaved: () => void;
}) {
  const shape = geometryOf(block.current);

  return (
    <section className={styles.walk} aria-labelledby={`s-${block.season}`}>
      <h2 id={`s-${block.season}`} className={styles.blockHead}>
        {block.season}
      </h2>

      {/*
        THE THREE STATES, KEPT APART. A withheld shape is not a missing one:
        the boundary was walked, its figures are right here, and only the
        coordinates were not sent to this reader (C-7.8).
      */}
      {shape.kind === 'shown' && block.current ? (
        <div className={styles.shapeWrap}>
          <Boundary
            farm={boundaryAsFarm(record, block.current, shape.ring)}
            size={240}
            showArea={false}
          />
        </div>
      ) : shape.kind === 'withheld' ? (
        <p className={styles.note}>
          This boundary was walked by another officer, so its shape is not shown to you. Its
          measurements are below.
        </p>
      ) : (
        <p className={styles.note}>No boundary has been walked for this season.</p>
      )}

      {block.current ? (
        <dl className={styles.figures}>
          <div>
            <dt>Area</dt>
            {/* The server's figure. The walk's estimate never appears here. */}
            <dd className="mono">
              {block.current.area_ha === undefined ? (
                <span className={styles.none}>not shown</span>
              ) : (
                `${block.current.area_ha} ha`
              )}
            </dd>
          </div>
          <div>
            <dt>GPS accuracy</dt>
            <dd className="mono">
              {block.current.gps_accuracy_m === undefined ? (
                <span className={styles.none}>not shown</span>
              ) : (
                `±${block.current.gps_accuracy_m} m`
              )}{' '}
              <span className={styles[`grade_${gradeFor(block.current)}`]}>
                {gradeFor(block.current)}
              </span>
            </dd>
          </div>
          <div>
            <dt>Corners</dt>
            <dd className="mono">
              {block.current.point_count === undefined ? (
                <span className={styles.none}>not shown</span>
              ) : (
                block.current.point_count
              )}
            </dd>
          </div>
          <div>
            <dt>Mapped</dt>
            <dd>{formatDate(block.current.mapped_at)}</dd>
          </div>
        </dl>
      ) : null}

      <SeasonCrops block={block} farmId={record.id} onSaved={onSaved} />

      {/*
        SUPERSEDED BOUNDARIES ARE KEPT, NOT DELETED, and are read-only: no route
        edits a boundary's geometry in place, so no control here offers to.
      */}
      {block.superseded.length > 0 ? (
        <div>
          <h3 className={styles.blockHead}>Earlier walks of this season</h3>
          <ul className={styles.list}>
            {block.superseded.map((old) => (
              <li key={old.id} className={styles.seasonRow}>
                <span className={styles.seasonFacts}>
                  {old.area_ha === undefined ? 'area not shown' : `${old.area_ha} ha`} ·{' '}
                  {old.point_count === undefined
                    ? 'corners not shown'
                    : `${old.point_count} corners`}{' '}
                  · {gradeFor(old)} · {formatDate(old.mapped_at)}
                </span>
                <span className={styles.superseded}>replaced, kept on record</span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </section>
  );
}

/**
 * CROPS FOR ONE SEASON, editable in place.
 *
 * `PUT /api/farms/:id/crops` is officer-only, caseload-checked, and REPLACES
 * the season's declarations. So an empty list is a real instruction -- nothing
 * is planted here this season -- and the screen says so rather than treating
 * it as a blank form.
 *
 * WHAT THE CONTRACT CANNOT TELL US: a season with no crop rows may never have
 * been declared, or may have been declared empty. The response is identical
 * either way. So this reports what the record holds -- none recorded -- and
 * does not claim which of the two happened.
 */
function SeasonCrops({
  block,
  farmId,
  onSaved,
}: {
  block: SeasonBlock;
  farmId: string;
  onSaved: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [crops, setCrops] = useState<readonly Crop[]>(block.crops);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const save = () => {
    setError(null);
    setSaving(true);
    declareCrops(farmId, buildCrops(block.season, crops))
      .then(() => {
        setEditing(false);
        onSaved();
      })
      .catch((e: unknown) => setError(classify(e).explanation))
      .finally(() => setSaving(false));
  };

  if (!editing) {
    return (
      <div className={styles.cropsRead}>
        <h3 className={styles.blockHead}>Crops</h3>
        <p className={styles.body}>
          {block.crops.length === 0 ? (
            <span className={styles.none}>None recorded for this season.</span>
          ) : (
            block.crops.map((crop) => CROP_LABELS[crop]).join(', ')
          )}
        </p>
        <Button
          variant="secondary"
          className={styles.wide}
          onClick={() => {
            setCrops(block.crops);
            setEditing(true);
          }}
        >
          Edit crops
        </Button>
      </div>
    );
  }

  return (
    <div className={styles.cropsRead}>
      <h3 className={styles.blockHead}>Crops</h3>
      <div className={styles.crops} role="group" aria-label={`Crops for ${block.season}`}>
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
      <p className={styles.note}>
        Saving replaces what is recorded for <span className="mono">{block.season}</span>. Leaving
        all unticked records that nothing is planted.
      </p>
      {error ? (
        <p className={styles.fieldError} role="alert">
          {error}
        </p>
      ) : null}
      <Button className={styles.wide} onClick={save} disabled={saving}>
        {saving ? 'Saving…' : 'Save crops'}
      </Button>
      <Button
        variant="secondary"
        className={styles.wide}
        onClick={() => {
          setEditing(false);
          setError(null);
        }}
      >
        Cancel
      </Button>
    </div>
  );
}
