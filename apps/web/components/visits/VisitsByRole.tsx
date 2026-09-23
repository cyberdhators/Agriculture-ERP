'use client';

import { OfficerVisits } from '@/components/officer/OfficerVisits';
import { usePreview } from '@/lib/preview';

import { VisitsLog } from './VisitsLog';

/**
 * `/visits`, answered differently for the officer.
 *
 * `GET /api/visits` accepts every role, and each sees only their own scope --
 * so this branch changes nothing about WHAT is returned, only how it reads. The
 * administrator's log is a dense table with payam filters, print and the
 * correct-and-remove controls that are theirs; an officer works one-handed on a
 * phone and needs their own recent work, not a report.
 *
 * THE ADMINISTRATOR'S LOG IS LEFT EXACTLY AS IT WAS. It already gates its
 * privileged controls behind `role === 'admin'`, and the routes refuse them
 * regardless of what any screen renders.
 */
export function VisitsByRole() {
  const { role } = usePreview();
  return role === 'officer' ? <OfficerVisits /> : <VisitsLog />;
}
