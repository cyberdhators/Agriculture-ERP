'use client';

import { OfficerLearning } from '@/components/officer/OfficerLearning';
import { usePreview } from '@/lib/preview';

import { LibraryScreen } from './LibraryScreen';

/**
 * `/library`, answered differently for the officer.
 *
 * `GET /api/learning-resources` accepts every role and already narrows a
 * non-administrator to published resources, so this branch changes nothing
 * about WHAT is returned — only how it reads. The administrator's screen is a
 * management surface with a dense table and the publish controls that are
 * theirs; an officer works one-handed on a phone and wants a shelf.
 *
 * The officer's version also carries the WEATHER for their county, because the
 * bottom bar gives them four destinations and reference material belongs
 * together rather than behind a fifth.
 *
 * THE ADMINISTRATOR'S SCREEN IS LEFT EXACTLY AS IT WAS.
 */
export function LibraryByRole() {
  const { role, hydrated } = usePreview();
  if (!hydrated) return null;
  return role === 'officer' ? <OfficerLearning /> : <LibraryScreen />;
}
