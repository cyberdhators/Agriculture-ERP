/**
 * The officers a farmer may be reassigned to (C-8R.2): active, in the
 * farmer's payam, and not the one who already holds them. The route enforces
 * all three and answers `reassign_officer_not_found` / `reassign_same_officer`
 * otherwise; filtering here means the picker never offers an officer the
 * route would refuse. Pure, so it is tested without React or a client.
 */
export interface CaseloadOfficer {
  id: string;
  name: string;
  payam_id: string;
}

export function eligibleOfficers(
  officers: readonly { id: string; name: string; payam_id: string; status: string }[],
  payamId: string | null,
  currentOfficerId: string | null,
): CaseloadOfficer[] {
  // 2026-10-28: an account with no location yet has no officer to move to.
  if (!payamId) return [];
  return officers
    .filter((o) => o.status === 'active' && o.payam_id === payamId && o.id !== currentOfficerId)
    .map(({ id, name, payam_id }) => ({ id, name, payam_id }))
    .sort((a, b) => a.name.localeCompare(b.name));
}
