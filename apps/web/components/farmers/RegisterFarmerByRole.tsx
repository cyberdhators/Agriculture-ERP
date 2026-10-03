'use client';

import { OfficerRegisterFarmer } from '@/components/officer/OfficerRegisterFarmer';
import { usePreview } from '@/lib/preview';

import { RegisterFarmer } from './RegisterFarmer';

/**
 * `/farmers/new`, answered differently for the two roles that may write here.
 *
 * `POST /api/farmers` accepts an administrator and an officer, and gives them
 * genuinely different powers: an administrator may register into any payam and
 * credit any officer, while an officer may do neither. The existing form is
 * built for the first -- a state, county and payam cascade, and an officer
 * picker -- and every one of those choices is a dead end for an officer, whose
 * only accepted payam is their own.
 *
 * So the officer gets a form shaped like their authority instead of a form
 * shaped like the administrator's with most of it refused on submit.
 *
 * THIS BRANCH IS PRESENTATION ONLY. Both forms post to the same route, which
 * re-checks the role, the payam and the registrar on the server. Reaching the
 * administrator's form as an officer would win nothing: the 403 is issued
 * there, not here.
 */
export function RegisterFarmerByRole() {
  const { role } = usePreview();
  return role === 'officer' ? <OfficerRegisterFarmer /> : <RegisterFarmer />;
}
