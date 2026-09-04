'use client';

import type { Farm } from '@/lib/fixtures/farmers';
import { t, type Language } from '@/lib/i18n';

import styles from './farmer.module.css';

const VBW = 520;
const VBH = 380;
const PAD = 40;
const METRES_PER_DEG = 111_320;

interface Plot {
  id: string;
  points: string;
  cx: number;
  cy: number;
  area_ha: number;
  index: number;
}

/** A round metric length near `target`, from the 1 / 2 / 5 × 10ⁿ ladder. */
function niceMetres(target: number): number {
  const pow = Math.pow(10, Math.floor(Math.log10(target)));
  const n = target / pow;
  const step = n >= 5 ? 5 : n >= 2 ? 2 : 1;
  return step * pow;
}

/**
 * The whole holding on one survey map: every walked plot fitted into a single
 * shared frame — longitude compressed by the cosine of the latitude so shapes
 * are not stretched — with a north arrow, a metric scale bar read from the
 * lon/lat extents, each plot's hectares stamped in mono at its centroid, and
 * the selected plot lifted. No map library, no tiles, no network — the same
 * fixture GeoJSON the officer walked. Plots with no usable boundary are absent
 * from the map and accounted for in the table beside it.
 */
export function PlotMap({
  farms,
  selectedId,
  onSelect,
  lang,
}: {
  farms: readonly Farm[];
  selectedId?: string;
  onSelect?: (id: string) => void;
  lang: Language;
}) {
  const usable = farms.filter((f) => {
    const ring = f.boundary?.coordinates[0];
    return ring && ring.length >= 4 && f.accuracy_flag !== 'unusable';
  });

  if (usable.length === 0) {
    return (
      <div className={styles.mapEmpty} role="img" aria-label={t('account.boundaryNone', lang)}>
        <span>{t('account.boundaryNone', lang)}</span>
      </div>
    );
  }

  // One bounding box over every walked ring.
  const lons: number[] = [];
  const lats: number[] = [];
  usable.forEach((f) =>
    f.boundary!.coordinates[0].forEach(([lon, lat]) => {
      lons.push(lon);
      lats.push(lat);
    }),
  );
  const minLon = Math.min(...lons);
  const maxLon = Math.max(...lons);
  const minLat = Math.min(...lats);
  const maxLat = Math.max(...lats);
  const midLat = (minLat + maxLat) / 2;
  const lonScale = Math.cos((midLat * Math.PI) / 180) || 1;

  const w = Math.max((maxLon - minLon) * lonScale, 1e-9);
  const h = Math.max(maxLat - minLat, 1e-9);
  const scale = Math.min((VBW - PAD * 2) / w, (VBH - PAD * 2) / h);
  const offX = PAD + (VBW - PAD * 2 - w * scale) / 2;
  const offY = PAD + (VBH - PAD * 2 - h * scale) / 2;

  const toXY = (lon: number, lat: number): [number, number] => [
    offX + (lon - minLon) * lonScale * scale,
    offY + (maxLat - lat) * scale,
  ];

  const plots: Plot[] = usable.map((f) => {
    const ring = f.boundary!.coordinates[0];
    let sx = 0;
    let sy = 0;
    const points = ring
      .map(([lon, lat]) => {
        const [x, y] = toXY(lon, lat);
        sx += x;
        sy += y;
        return `${x.toFixed(1)},${y.toFixed(1)}`;
      })
      .join(' ');
    return {
      id: f.id,
      points,
      cx: sx / ring.length,
      cy: sy / ring.length,
      area_ha: f.area_ha,
      index: farms.indexOf(f) + 1,
    };
  });

  // Scale bar: a round distance about a quarter of the frame wide.
  const pxPerMetre = scale / METRES_PER_DEG;
  const barMetres = niceMetres((VBW - PAD * 2) * 0.25 / pxPerMetre);
  const barPx = barMetres * pxPerMetre;
  const barY = VBH - PAD / 2;
  const barX = PAD;

  return (
    <svg
      className={styles.map}
      viewBox={`0 0 ${VBW} ${VBH}`}
      role="img"
      aria-label={t('account.holdingMap', lang)}
    >
      <rect x={0} y={0} width={VBW} height={VBH} className={styles.mapField} />

      {plots.map((p) => {
        const selected = p.id === selectedId;
        return (
          <g
            key={p.id}
            className={selected ? styles.mapPlotOn : styles.mapPlot}
            role={onSelect ? 'button' : undefined}
            tabIndex={onSelect ? 0 : undefined}
            aria-label={`${t('account.plot', lang)} ${p.index}`}
            aria-pressed={onSelect ? selected : undefined}
            onClick={onSelect ? () => onSelect(p.id) : undefined}
            onKeyDown={
              onSelect
                ? (e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      onSelect(p.id);
                    }
                  }
                : undefined
            }
          >
            <polygon points={p.points} />
            <text x={p.cx} y={p.cy} className={styles.mapArea} textAnchor="middle">
              {p.area_ha.toFixed(2)} ha
            </text>
          </g>
        );
      })}

      {/* North arrow */}
      <g className={styles.mapNorth} transform={`translate(${VBW - PAD / 2 - 4}, ${PAD / 2 + 6})`}>
        <polygon points="0,-14 5,4 0,-1 -5,4" />
        <text y="18" textAnchor="middle">
          {t('account.mapNorth', lang)}
        </text>
      </g>

      {/* Scale bar */}
      <g className={styles.mapScale}>
        <line x1={barX} y1={barY} x2={barX + barPx} y2={barY} />
        <line x1={barX} y1={barY - 4} x2={barX} y2={barY + 4} />
        <line x1={barX + barPx} y1={barY - 4} x2={barX + barPx} y2={barY + 4} />
        <text x={barX} y={barY - 8}>
          {barMetres >= 1000 ? `${barMetres / 1000} km` : `${barMetres} m`}
        </text>
      </g>
    </svg>
  );
}
