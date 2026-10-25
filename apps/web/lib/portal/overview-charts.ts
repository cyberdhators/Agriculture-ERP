/**
 * THE OVERVIEW'S TWO CHARTS, THE ARITHMETIC (2026-10-28). Pure, so it is
 * tested without a browser: where each bar and each point of a line sits in
 * an SVG box. Inline SVG only -- the portal has no chart library.
 */

export interface ChartBox {
  readonly width: number;
  readonly height: number;
  /** Space kept at the top so the tallest mark is not clipped. */
  readonly pad: number;
}

/** A ceiling for the axis: the largest value, never below 1, so an all-zero chart still draws. */
export const ceilingOf = (...series: readonly (readonly number[])[]): number =>
  Math.max(1, ...series.flat());

/** One bar per value, left to right, sharing the width; heights scale to `max`. */
export function barRects(
  values: readonly number[],
  box: ChartBox,
  max: number = ceilingOf(values),
): { x: number; y: number; width: number; height: number }[] {
  if (values.length === 0) return [];
  const slot = box.width / values.length;
  const gap = Math.min(2, slot * 0.2);
  const usable = box.height - box.pad;
  return values.map((v, i) => {
    const h = max <= 0 ? 0 : (Math.max(0, v) / max) * usable;
    return {
      x: round(i * slot + gap / 2),
      y: round(box.height - h),
      width: round(Math.max(0.5, slot - gap)),
      height: round(h),
    };
  });
}

/** An SVG path through the values, evenly spaced; a single value is a short flat line. */
export function linePath(
  values: readonly number[],
  box: ChartBox,
  max: number = ceilingOf(values),
): string {
  if (values.length === 0) return '';
  const usable = box.height - box.pad;
  const y = (v: number) => round(box.height - (max <= 0 ? 0 : (Math.max(0, v) / max) * usable));
  if (values.length === 1) return `M0 ${y(values[0]!)} L${box.width} ${y(values[0]!)}`;
  const step = box.width / (values.length - 1);
  return values.map((v, i) => `${i === 0 ? 'M' : 'L'}${round(i * step)} ${y(v)}`).join(' ');
}

/** Sum of a series, for the chart's caption and its text alternative. */
export const total = (values: readonly number[]): number => values.reduce((n, v) => n + v, 0);

const round = (n: number) => Math.round(n * 100) / 100;
