import type { Farm, Ring } from '@/lib/fixtures/farmers';

import styles from './farmers.module.css';

/**
 * A farm boundary drawn as an inline SVG polygon straight from the fixture
 * GeoJSON — no map library, no tiles, no network. The lon/lat ring is fitted
 * to a square box (longitude compressed by the cosine of the latitude so the
 * shape is not stretched), the forest stroke traces the walked plot, the amber
 * tint fills it, a dot marks the centroid and the area is stamped in mono.
 *
 * Two sizes: 96px for the register table, 360px for the dossier. When a plot
 * has no usable boundary — a self-registration with no walk, or a GPS trace
 * flagged unusable — it says so plainly in the same box rather than drawing a
 * shape that would lie about the land.
 */

interface Projected {
  points: string;
  cx: number;
  cy: number;
}

/** Fit a lon/lat ring into a `size`×`size` box with `pad` inset, keeping shape. */
function project(ring: Ring, size: number, pad: number): Projected {
  const inner = size - pad * 2;
  const lons = ring.map((p) => p[0]);
  const lats = ring.map((p) => p[1]);
  const minLon = Math.min(...lons);
  const maxLon = Math.max(...lons);
  const minLat = Math.min(...lats);
  const maxLat = Math.max(...lats);
  const midLat = (minLat + maxLat) / 2;
  const lonScale = Math.cos((midLat * Math.PI) / 180) || 1;

  const w = Math.max((maxLon - minLon) * lonScale, 1e-9);
  const h = Math.max(maxLat - minLat, 1e-9);
  const scale = Math.min(inner / w, inner / h);
  const offX = pad + (inner - w * scale) / 2;
  const offY = pad + (inner - h * scale) / 2;

  const toXY = (lon: number, lat: number): [number, number] => [
    offX + (lon - minLon) * lonScale * scale,
    // Flip: latitude grows north (up), SVG y grows down.
    offY + (maxLat - lat) * scale,
  ];

  const points = ring
    .map(([lon, lat]) =>
      toXY(lon, lat)
        .map((n) => n.toFixed(2))
        .join(','),
    )
    .join(' ');
  let sx = 0;
  let sy = 0;
  for (const [lon, lat] of ring) {
    const [x, y] = toXY(lon, lat);
    sx += x;
    sy += y;
  }
  return { points, cx: sx / ring.length, cy: sy / ring.length };
}

function formatArea(ha: number): string {
  return `${ha.toFixed(2)} ha`;
}

export function Boundary({
  farm,
  size = 96,
  showArea = true,
}: {
  farm: Farm;
  size?: number;
  showArea?: boolean;
}) {
  const large = size >= 240;
  const pad = large ? 18 : 8;
  const ring = farm.boundary?.coordinates[0];
  const usable = ring && ring.length >= 4 && farm.accuracy_flag !== 'unusable';

  if (!usable) {
    const reason = !ring ? 'No boundary walked' : 'Trace unusable';
    return (
      <div
        className={styles.boundaryEmpty}
        style={{ width: size, height: size }}
        role="img"
        aria-label={`${reason} for this farm`}
      >
        <svg viewBox={`0 0 ${size} ${size}`} width={size} height={size} aria-hidden="true">
          <rect
            x={pad}
            y={pad}
            width={size - pad * 2}
            height={size - pad * 2}
            className={styles.boundaryEmptyRect}
          />
        </svg>
        <span className={styles.boundaryEmptyLabel}>{large ? reason : 'No plot'}</span>
      </div>
    );
  }

  const { points, cx, cy } = project(ring, size, pad);
  const dot = large ? 4 : 2.5;

  return (
    <figure className={styles.boundary} style={{ width: size }}>
      <svg
        viewBox={`0 0 ${size} ${size}`}
        width={size}
        height={size}
        className={styles.boundarySvg}
        role="img"
        aria-label={`Farm boundary, ${formatArea(farm.area_ha)}, ${farm.point_count} points`}
      >
        <polygon points={points} className={styles.boundaryPoly} />
        <circle cx={cx} cy={cy} r={dot} className={styles.boundaryCentroid} />
      </svg>
      {showArea ? (
        <figcaption className={styles.boundaryArea}>{formatArea(farm.area_ha)}</figcaption>
      ) : null}
    </figure>
  );
}
