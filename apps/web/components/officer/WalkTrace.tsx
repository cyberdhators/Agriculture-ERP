'use client';

import { canClose, type WalkPoint } from '@/lib/officer/farm-mapping';

import styles from './officer-farms.module.css';

/**
 * THE WALK SO FAR, DRAWN FROM THE READINGS THEMSELVES.
 *
 * Not a map. There are no tiles, no map library and no network: this is an
 * inline SVG of the points the officer has actually marked, fitted to a square
 * box with longitude compressed by the cosine of the latitude so the plot is
 * not stretched. That matters in a field — a tile layer needs a connection the
 * officer may not have, and would invite precision tapping on a small screen
 * when the position is supposed to come from the device.
 *
 * It is deliberately a TRACE rather than a filled shape until there are enough
 * corners to close: while walking, what the officer needs to see is where they
 * have been and whether they are back at the start, not a polygon that implies
 * a finished plot.
 *
 * WITH NOTHING MARKED IT DRAWS NOTHING and says so. An empty box is not a
 * farm of zero area.
 */
const SIZE = 240;
const PAD = 16;

export function WalkTrace({ points }: { points: readonly WalkPoint[] }) {
  if (points.length === 0) {
    return (
      <div className={styles.traceEmpty} role="img" aria-label="No corners marked yet">
        No corners marked yet
      </div>
    );
  }

  const lons = points.map((p) => p.longitude);
  const lats = points.map((p) => p.latitude);
  const minLon = Math.min(...lons);
  const maxLon = Math.max(...lons);
  const minLat = Math.min(...lats);
  const maxLat = Math.max(...lats);
  const midLat = (minLat + maxLat) / 2;
  const lonScale = Math.cos((midLat * Math.PI) / 180) || 1;

  const inner = SIZE - PAD * 2;
  const width = Math.max((maxLon - minLon) * lonScale, 1e-9);
  const height = Math.max(maxLat - minLat, 1e-9);
  const scale = Math.min(inner / width, inner / height);
  const offX = PAD + (inner - width * scale) / 2;
  const offY = PAD + (inner - height * scale) / 2;

  const xy = points.map((p) => ({
    x: offX + (p.longitude - minLon) * lonScale * scale,
    // Latitude grows northward; SVG y grows downward.
    y: offY + (maxLat - p.latitude) * scale,
  }));
  const path = xy.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ');
  const closable = canClose(points);

  return (
    <svg
      className={styles.trace}
      viewBox={`0 0 ${SIZE} ${SIZE}`}
      role="img"
      aria-label={`${points.length} corners marked`}
    >
      {closable ? (
        <polygon points={path} className={styles.traceFill} />
      ) : (
        <polyline points={path} className={styles.traceLine} />
      )}
      {closable ? <polygon points={path} className={styles.traceLineOnly} /> : null}
      {xy.map((p, i) => (
        <circle
          key={`${p.x},${p.y},${i}`}
          cx={p.x}
          cy={p.y}
          r={i === 0 ? 5 : 3.5}
          className={i === 0 ? styles.traceStart : styles.traceDot}
        />
      ))}
    </svg>
  );
}
