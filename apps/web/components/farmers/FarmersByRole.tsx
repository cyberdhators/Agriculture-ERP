'use client';

import { OfficerFarmers } from '@/components/officer/OfficerFarmers';
import { usePreview } from '@/lib/preview';

import { FarmersRegister } from './FarmersRegister';

/**
 * ONE ADDRESS, TWO SCREENS, CHOSEN BY ROLE.
 *
 * `/farmers` means different things to different people. An administrator or a
 * supervisor is looking at a register: every farmer in scope, filtered by
 * geography and status, printable, with selection for reading a set of rows.
 * An officer is looking at their own caseload on a phone, deciding who to walk
 * to. Those are different screens, and the register was not bent into both.
 *
 * WHY A BRANCH RATHER THAN CONDITIONALS INSIDE THE REGISTER. Threading `role`
 * through six hundred lines would leave one component owning two products,
 * where every future change to either has to be reasoned about twice and the
 * mobile case is the one that gets forgotten. Splitting at the top keeps the
 * administrator's register exactly as it was -- not one line changed -- and
 * lets the officer's screen be built for a thumb without apology.
 *
 * THIS IS PRESENTATION, NEVER AUTHORISATION. Both screens call the same route,
 * and `GET /api/farmers` scopes what it returns by the caller's own principal:
 * an officer receives their caseload because of the WHERE clause, not because
 * of the component they were given. Rendering the register to an officer would
 * be ugly and would leak nothing.
 */
export function FarmersByRole() {
  const { role } = usePreview();
  return role === 'officer' ? <OfficerFarmers /> : <FarmersRegister />;
}
