'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';

import { LIVE_FARMS, listFarmGeoJson, removeFarm } from '@/lib/farms/api';
import {
  EMPTY_MAP_FILTERS,
  GRADE_LABELS,
  GRADE_NOTES,
  areaOnPage,
  formatCoordinate,
  hasMapFilters,
  toMapParams,
  toMapRow,
  type FarmMapRow,
  type MapFilters,
} from '@/lib/farms/map-view';
import { useLocationNames } from '@/lib/portal/locations';
import { usePreview } from '@/lib/preview';
import { formatDate } from '@/lib/format';
import type { Farm } from '@/lib/fixtures/farmers';

import { Boundary } from '../farmers/Boundary';
import { Button, ButtonLink, Dialog, Field, Notice, PageHeader, Select } from '../ui';
import { CardSkeleton, Pagination, UnavailableState } from '../ui/data';
import styles from './farms.module.css';

/**
 * FARMS & MAPS — the administrator's inspection workspace.
 *
 * AN INSPECTOR'S SCREEN, NOT A FIELDWORKER'S. There is no control here to
 * create a farm, walk or re-walk a boundary, re-grade an accuracy reading,
 * declare a crop or record a visit — not disabled, not behind a tooltip,
 * ABSENT. Those acts belong to an officer standing in the field with a phone,
 * and the database enforces it: the boundary routes are officer-only. An
 * administrator reads what was recorded and, where the record is wrong, removes
 * it. Nothing more.
 *
 * WHERE THE DATA COMES FROM. `GET /api/farms/geojson` — administrator and
 * supervisor only, scoped by the server, current boundaries only, `unusable`
 * traces excluded, cursor-paginated, filterable by payam and season. Those two
 * filters are the whole of what the route accepts and the whole of what this
 * screen offers.
 *
 * THE MAP IS NOT THE ONLY WAY IN. Every shape is accompanied by the record in
 * words — season, area, the grade the backend assigned, the centroid as a
 * coordinate, the date it was mapped — because a drawn polygon is unreadable
 * to anyone using a screen reader, and because an administrator checking a
 * figure wants the number, not a picture of it.
 */

const YEARS = [0, 1, 2].map((back) => new Date().getUTCFullYear() - back);
const SEASONS = YEARS.flatMap((year) => [`${year}-main`, `${year}-second`]);

const GRADE_CLASS: Record<string, string> = {
  good: styles.gradeGood ?? '',
  poor: styles.gradePoor ?? '',
  unusable: styles.gradeUnusable ?? '',
};

/** The shape only. Reuses the approved inline-SVG renderer; no map library. */
const asFarmShape = (row: FarmMapRow): Farm =>
  ({
    boundary: row.ring ? { type: 'Polygon', coordinates: [row.ring] } : null,
    accuracy_flag: row.grade,
    area_ha: row.areaHa,
  }) as unknown as Farm;

export function FarmsMap() {
  const { role, hydrated } = usePreview();
  const names = useLocationNames(hydrated);

  const [filters, setFilters] = useState<MapFilters>(EMPTY_MAP_FILTERS);
  const [draft, setDraft] = useState<MapFilters>(EMPTY_MAP_FILTERS);
  const [rows, setRows] = useState<FarmMapRow[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [back, setBack] = useState<Array<string | null>>([]);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(LIVE_FARMS);
  const [error, setError] = useState<string | undefined>();
  const [forbidden, setForbidden] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [confirmRemove, setConfirmRemove] = useState<FarmMapRow | null>(null);
  const [busy, setBusy] = useState(false);
  const [outcome, setOutcome] = useState<string | undefined>();

  const isAdmin = hydrated && role === 'admin';
  const params = useMemo(() => toMapParams(filters, cursor ?? undefined), [filters, cursor]);
  const paramsKey = JSON.stringify(params);

  useEffect(() => {
    if (!LIVE_FARMS || !hydrated) return;
    let live = true;
    setLoading(true);
    listFarmGeoJson({ ...(JSON.parse(paramsKey) as object), limit: 24 })
      .then((page) => {
        if (!live) return;
        setRows(page.features.map(toMapRow));
        setNextCursor(page.cursor);
        setHasMore(page.hasMore);
        setForbidden(false);
        setError(undefined);
      })
      .catch((err: unknown) => {
        if (!live) return;
        // A 403 is not a broken screen and not a reason to send anybody to
        // sign-in: the map is an administrator's and a supervisor's, and the
        // route says so. Anything else is reported as a service error.
        const status = (err as { status?: number }).status;
        if (status === 403) setForbidden(true);
        else setError('Could not load this information.');
      })
      .finally(() => live && setLoading(false));
    return () => {
      live = false;
    };
  }, [paramsKey, hydrated, attempt]);

  const apply = useCallback(() => {
    setCursor(null);
    setBack([]);
    setFilters(draft);
  }, [draft]);

  const clear = useCallback(() => {
    setCursor(null);
    setBack([]);
    setDraft(EMPTY_MAP_FILTERS);
    setFilters(EMPTY_MAP_FILTERS);
  }, []);

  const remove = useCallback(async (row: FarmMapRow) => {
    setBusy(true);
    try {
      await removeFarm(row.farmId);
      setRows((list) => list.filter((r) => r.farmId !== row.farmId));
      setOutcome('Farm removed from active use. Its boundaries and history remain on the record.');
      setConfirmRemove(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'The farm could not be removed.');
    } finally {
      setBusy(false);
    }
  }, []);

  if (!hydrated) return null;

  const placeOf = (row: FarmMapRow) =>
    [names.state(row.stateId) ?? row.stateId, names.county(row.countyId), names.payam(row.payamId)]
      .filter(Boolean)
      .join(' › ');

  return (
    <div className={styles.stack}>
      <PageHeader
        eyebrow="Field operations"
        title="Farms &amp; maps"
        subtitle="Where each farm is and what boundary an officer recorded. Read and, where a record is wrong, remove it."
      />

      <div className={styles.scopeBand}>
        <span>{role === 'admin' ? 'National scope · all states' : 'Your assigned state'}</span>
        <span className={styles.scopeBandNote}>
          {LIVE_FARMS ? null : 'No live farm data on this deployment.'}
        </span>
      </div>

      {outcome ? (
        <Notice kind="success" title="Recorded">
          <p className="small">{outcome}</p>
        </Notice>
      ) : null}

      {error ? (
        <Notice kind="error" title="Could not load this information">
          <p className="small">
            {error}{' '}
            <Button variant="ghost" size="small" onClick={() => setAttempt((n) => n + 1)}>
              Try again
            </Button>
          </p>
        </Notice>
      ) : null}

      {/* ---- Payam and season: the two filters the route accepts ------- */}
      <div className={styles.filters}>
        <div className={styles.filterGrid}>
          <Field label="Payam">
            {(ids) => (
              <Select
                {...ids}
                value={draft.payam}
                onChange={(e) => setDraft({ ...draft, payam: e.target.value })}
              >
                <option value="">Any payam</option>
                {names.payamsIn('', '').map((row) => (
                  <option key={row.id} value={row.id}>
                    {row.name}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <Field label="Season">
            {(ids) => (
              <Select
                {...ids}
                value={draft.season}
                onChange={(e) => setDraft({ ...draft, season: e.target.value })}
              >
                <option value="">Any season</option>
                {SEASONS.map((season) => (
                  <option key={season} value={season}>
                    {season}
                  </option>
                ))}
              </Select>
            )}
          </Field>
        </div>
        <div className={styles.filterFoot}>
          <Button onClick={apply}>Apply filters</Button>
          <Button variant="secondary" onClick={clear}>
            Clear filters
          </Button>
        </div>
      </div>

      {forbidden ? (
        <UnavailableState title="The map is not available to your role">
          Boundary coordinates are served to administrators and supervisors only. Your other field
          information is unaffected.
        </UnavailableState>
      ) : loading ? (
        <CardSkeleton count={6} />
      ) : !LIVE_FARMS ? (
        <UnavailableState title="No live farm data on this deployment">
          Boundaries are read from the map route when farm data is switched on. Nothing is shown
          here rather than placeholder shapes, because an invented boundary is worse than none.
        </UnavailableState>
      ) : rows.length === 0 ? (
        <Notice
          kind="info"
          title={
            hasMapFilters(filters) ? 'No farms match the current filters' : 'No farms recorded yet'
          }
        >
          <p className="small">
            {hasMapFilters(filters) ? (
              <>
                Nothing recorded matches this payam and season.{' '}
                <Button variant="ghost" size="small" onClick={clear}>
                  Clear filters
                </Button>
              </>
            ) : (
              'When an officer walks a boundary it appears here.'
            )}
          </p>
        </Notice>
      ) : (
        <>
          <p className={styles.pageNote}>
            {rows.length} recorded {rows.length === 1 ? 'boundary' : 'boundaries'} on this page,{' '}
            {areaOnPage(rows).toFixed(1)} ha in total. The register continues beyond this page; no
            national total is available.
          </p>

          <div className={styles.grid}>
            {rows.map((row) => (
              <article key={row.boundaryId} className={styles.card}>
                <div className={styles.shape}>
                  <Boundary farm={asFarmShape(row)} size={112} showArea={false} />
                </div>
                <div className={styles.facts}>
                  <h2 className={styles.season}>{row.season}</h2>
                  <span className={`${styles.grade} ${GRADE_CLASS[row.grade] ?? ''}`}>
                    <span title={GRADE_NOTES[row.grade]}>GPS {GRADE_LABELS[row.grade]}</span>
                  </span>
                  <p className={styles.factRow}>
                    <span className={styles.factLabel}>Area</span>
                    <span>{row.areaHa.toFixed(2)} ha</span>
                  </p>
                  <p className={styles.factRow}>
                    <span className={styles.factLabel}>Place</span>
                    <span>{placeOf(row)}</span>
                  </p>
                  <p className={styles.factRow}>
                    <span className={styles.factLabel}>Centroid</span>
                    {row.centroid ? (
                      <span className={styles.coord}>
                        {formatCoordinate(row.centroid.lon, row.centroid.lat)}
                      </span>
                    ) : (
                      <span className="muted">Not recorded</span>
                    )}
                  </p>
                  <p className={styles.factRow}>
                    <span className={styles.factLabel}>Mapped</span>
                    <span>{formatDate(row.mappedAt)}</span>
                  </p>
                  <div className={styles.cardFoot}>
                    <ButtonLink href={`/farmers/${row.farmerId}`} variant="secondary" size="small">
                      Open farmer
                    </ButtonLink>
                    {isAdmin ? (
                      <Button variant="danger" size="small" onClick={() => setConfirmRemove(row)}>
                        Remove farm
                      </Button>
                    ) : null}
                  </div>
                </div>
              </article>
            ))}
          </div>

          <Pagination
            shown={rows.length}
            hasMore={hasMore}
            busy={loading}
            canGoBack={back.length > 0}
            onNext={() => {
              if (!nextCursor) return;
              setBack((past) => [...past, cursor]);
              setCursor(nextCursor);
            }}
            onPrevious={() =>
              setBack((past) => {
                if (past.length === 0) return past;
                setCursor(past[past.length - 1] ?? null);
                return past.slice(0, -1);
              })
            }
          />
        </>
      )}

      <Dialog
        open={confirmRemove !== null}
        onClose={() => setConfirmRemove(null)}
        title="Remove farm?"
        footer={
          <>
            <Button variant="ghost" onClick={() => setConfirmRemove(null)}>
              Cancel
            </Button>
            <Button
              variant="danger"
              disabled={busy}
              onClick={() => (confirmRemove ? void remove(confirmRemove) : undefined)}
            >
              {busy ? 'Removing…' : 'Remove farm'}
            </Button>
          </>
        }
      >
        {confirmRemove ? (
          <>
            <p>
              Remove the farm recorded for season <strong>{confirmRemove.season}</strong> in{' '}
              {placeOf(confirmRemove)}?
            </p>
            <p className="small muted">
              This removes the farm from active use, from counts and from exports. Historical
              records remain: the farm, its boundaries and its audit trail stay on file. It is not a
              permanent deletion, and there is no undo — an officer would have to map the farm
              again.
            </p>
          </>
        ) : null}
      </Dialog>
    </div>
  );
}
