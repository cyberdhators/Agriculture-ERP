/**
 * Which weather row a farmer sees. The contract (docs/api/weather-contract.md,
 * #78) says county-level locations are the honest starting point, that
 * neighbouring payams read alike, and that no screen should invite comparison
 * between them. So a farmer gets ONE row: their own payam's if the route has
 * one, else their county's, else nothing. Location ids are STATE-COUNTY-PAYAM
 * (C-2), so the county is the first two segments.
 */
export interface WeatherRowKey {
  /** Null for a county-level location (contract §9.1), which is most of them. */
  payam_id: string | null;
  county_id: string;
}

export function countyOf(payamId: string): string {
  return payamId.split('-').slice(0, 2).join('-');
}

export function pickLocation<T extends WeatherRowKey>(
  rows: readonly T[],
  payamId: string,
): T | null {
  const own = rows.find((r) => r.payam_id !== null && r.payam_id === payamId);
  if (own) return own;
  const county = countyOf(payamId);
  return rows.find((r) => r.county_id === county) ?? null;
}
