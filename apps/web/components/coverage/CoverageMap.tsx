'use client';

import { useEffect, useMemo, useState } from 'react';

import { LIVE_FARMS, getAllFarmGeojson, type CoverageFeature } from '@/lib/farms/api';
import { FARMS, STATE_NAMES, farmerById, farmerPayamName } from '@/lib/fixtures/farmers';
import { usePreview } from '@/lib/preview';

import { Card, EmptyState, KpiStrip, Notice, PageHeader } from '../ui';
import farmers from '../farmers/farmers.module.css';
import styles from './coverage.module.css';

/**
 * The state's farm coverage: every visible current boundary drawn as one inline
 * SVG, no map library and no tiles, straight from the GeoJSON the API returns
 * (C-7.4). Each plot is filled by its payam and the payams are counted beside
 * the map, so a supervisor can see at a glance where the programme has walked
 * land and where it has not. Coordinates are the point of this view, so the
 * route serves them to supervisors and administrators only; officers and
 * read-only staff are told plainly that it is not theirs to open.
 */

const VIEW_W = 1000;
const VIEW_H = 640;
const PAD = 24;

// A categorical fill per payam, drawn from the palette tokens. Cycled when a
// state has more payams than colours; the legend keeps them apart by name.
const PALETTE = [
  'var(--green)',
  'var(--harvest)',
  'var(--nile)',
  'var(--sprout)',
  'var(--soil)',
  'var(--green-deep)',
  'var(--pending)',
  'var(--neutral)',
] as const;

interface Projected {
  id: string;
  payamId: string;
  points: string;
  color: string;
}

/** Coverage from the fixtures: one current boundary per farm, unusable traces
 *  and unwalked plots left out, scoped to what the role may see. */
function fixtureFeatures(role: string): CoverageFeature[] {
  const out: CoverageFeature[] = [];
  for (const farm of FARMS) {
    if (farm.accuracy_flag === 'unusable' || !farm.boundary) continue;
    const farmer = farmerById(farm.farmer_id);
    if (!farmer) continue;
    if (role === 'supervisor' && farmer.state_id !== 'CE') continue;
    out.push({
      id: farm.id,
      farmId: farm.id,
      boundaryId: farm.id,
      farmerId: farm.farmer_id,
      payamId: farmer.payam_id,
      countyId: farmer.payam_id.slice(0, 6),
      stateId: farmer.state_id,
      season: farm.season,
      areaHa: farm.area_ha,
      grade: farm.accuracy_flag,
      mappedAt: farm.mapped_at,
      // The fixture ring is read-only pairs; the view type carries plain pairs.
      geometry: {
        type: 'Polygon',
        coordinates: [
          farm.boundary.coordinates[0].map(([lon, lat]) => [lon, lat] as [number, number]),
        ],
      },
    });
  }
  return out;
}

function project(
  features: readonly CoverageFeature[],
  colorFor: (payamId: string) => string,
): Projected[] {
  const lons: number[] = [];
  const lats: number[] = [];
  for (const f of features) {
    for (const [lon, lat] of f.geometry.coordinates[0] ?? []) {
      lons.push(lon);
      lats.push(lat);
    }
  }
  if (lons.length === 0) return [];
  const minLon = Math.min(...lons);
  const maxLon = Math.max(...lons);
  const minLat = Math.min(...lats);
  const maxLat = Math.max(...lats);
  const midLat = (minLat + maxLat) / 2;
  const lonScale = Math.cos((midLat * Math.PI) / 180) || 1;
  const innerW = VIEW_W - PAD * 2;
  const innerH = VIEW_H - PAD * 2;
  const w = Math.max((maxLon - minLon) * lonScale, 1e-9);
  const h = Math.max(maxLat - minLat, 1e-9);
  const scale = Math.min(innerW / w, innerH / h);
  const offX = PAD + (innerW - w * scale) / 2;
  const offY = PAD + (innerH - h * scale) / 2;
  const toXY = (lon: number, lat: number): [number, number] => [
    offX + (lon - minLon) * lonScale * scale,
    offY + (maxLat - lat) * scale,
  ];
  return features.map((f) => ({
    id: f.id,
    payamId: f.payamId,
    color: colorFor(f.payamId),
    points: (f.geometry.coordinates[0] ?? [])
      .map(([lon, lat]) =>
        toXY(lon, lat)
          .map((n) => n.toFixed(1))
          .join(','),
      )
      .join(' '),
  }));
}

export function CoverageMap() {
  const { role, hydrated } = usePreview();
  const [liveFeatures, setLiveFeatures] = useState<CoverageFeature[] | null>(null);
  const [loadError, setLoadError] = useState<string | undefined>();

  const mayView = role === 'admin' || role === 'supervisor';

  useEffect(() => {
    if (!LIVE_FARMS || !mayView) return;
    let live = true;
    getAllFarmGeojson()
      .then((f) => live && (setLiveFeatures(f), setLoadError(undefined)))
      .catch(
        (e) => live && setLoadError(e instanceof Error ? e.message : 'Could not load coverage.'),
      );
    return () => {
      live = false;
    };
  }, [mayView]);

  const features = useMemo<CoverageFeature[]>(() => {
    if (!mayView) return [];
    if (LIVE_FARMS) return liveFeatures ?? [];
    return fixtureFeatures(role);
  }, [mayView, liveFeatures, role]);

  // Payams present, in name order, each with its palette colour, count and area.
  const payams = useMemo(() => {
    const byId = new Map<string, { payamId: string; count: number; area: number }>();
    for (const f of features) {
      const row = byId.get(f.payamId) ?? { payamId: f.payamId, count: 0, area: 0 };
      row.count += 1;
      row.area += f.areaHa;
      byId.set(f.payamId, row);
    }
    return [...byId.values()]
      .map((row) => ({ ...row, name: farmerPayamName(row.payamId) }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [features]);

  const colorFor = useMemo(() => {
    const index = new Map(payams.map((p, i) => [p.payamId, PALETTE[i % PALETTE.length]!]));
    return (payamId: string): string => index.get(payamId) ?? PALETTE[0]!;
  }, [payams]);

  const projected = useMemo(() => project(features, colorFor), [features, colorFor]);

  const totals = useMemo(() => {
    let area = 0;
    let good = 0;
    let poor = 0;
    for (const f of features) {
      area += f.areaHa;
      if (f.grade === 'good') good += 1;
      else if (f.grade === 'poor') poor += 1;
    }
    return { count: features.length, area, good, poor };
  }, [features]);

  const maxCount = payams.reduce((m, p) => Math.max(m, p.count), 0);
  const scopeName = role === 'admin' ? 'All states' : (STATE_NAMES.CE ?? 'Central Equatoria');

  return (
    <>
      <PageHeader
        eyebrow={`Coverage · ${scopeName}`}
        title="Farm coverage"
        subtitle="Every mapped plot the programme has walked, drawn from the boundaries on record and coloured by payam. It shows where land is registered and where it is not."
      />

      {hydrated && !mayView ? (
        <EmptyState
          error
          title="Coverage is for supervisors and administrators"
          body="The coverage map shows the boundaries of many farmers at once, so it is opened by supervisors and administrators. An officer sees each plot on the farmer's own record."
        />
      ) : (
        <>
          <div style={{ marginBottom: 'var(--s-6)' }}>
            <KpiStrip
              label="Coverage totals"
              items={[
                { label: 'Plots mapped', value: totals.count },
                { label: 'Area mapped', value: `${totals.area.toFixed(1)} ha` },
                { label: 'Payams', value: payams.length },
                { label: 'Good trace', value: totals.good },
                { label: 'Poor trace', value: totals.poor, accent: totals.poor > 0 },
              ]}
            />
          </div>

          {loadError ? (
            <Notice kind="error">
              <p className="small">{loadError}</p>
            </Notice>
          ) : null}

          <div className={styles.layout}>
            <Card padded>
              {projected.length === 0 ? (
                <EmptyState
                  title="No plots mapped yet"
                  body="No boundary has been walked in your scope. Plots appear here as officers map them in the field."
                />
              ) : (
                <>
                  <div className={styles.mapFrame}>
                    <svg
                      viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}
                      className={styles.map}
                      role="img"
                      aria-label={`Farm coverage map, ${totals.count} plots across ${payams.length} payams`}
                    >
                      {projected.map((p) => (
                        <polygon
                          key={p.id}
                          points={p.points}
                          className={styles.poly}
                          style={{ fill: p.color }}
                        />
                      ))}
                    </svg>
                  </div>
                  <p className={styles.caption}>
                    Each shape is one walked plot, its longitude compressed by the cosine of the
                    latitude so the land is not stretched. Colour marks the payam.
                  </p>
                </>
              )}
            </Card>

            <Card as="aside" padded>
              <div className={farmers.sectionHead}>
                <h2 className="label">Plots by payam</h2>
              </div>
              {payams.length === 0 ? (
                <p className="small muted">No coverage to show in your scope.</p>
              ) : (
                <div className={styles.legend}>
                  {payams.map((p) => {
                    const pct = maxCount === 0 ? 0 : Math.round((p.count / maxCount) * 100);
                    return (
                      <div key={p.payamId} className={styles.legendRow}>
                        <span
                          className={styles.swatch}
                          style={{ background: colorFor(p.payamId) }}
                          aria-hidden
                        />
                        <span className={styles.legendName} title={p.name}>
                          {p.name}
                        </span>
                        <span className={styles.legendValue}>
                          {p.count} · {p.area.toFixed(1)} ha
                        </span>
                        <span
                          className={farmers.coverageTrack}
                          style={{ gridColumn: '1 / -1' }}
                          role="img"
                          aria-label={`${p.count} plots in ${p.name}`}
                        >
                          <span className={farmers.coverageFill} style={{ width: `${pct}%` }} />
                        </span>
                      </div>
                    );
                  })}
                </div>
              )}
            </Card>
          </div>
        </>
      )}
    </>
  );
}
