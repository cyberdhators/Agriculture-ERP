'use client';

import Link from 'next/link';

import { UnavailableState } from '@/components/ui/data';
import { OfficerVisitDetail } from '@/components/officer/OfficerVisitDetail';
import { usePreview } from '@/lib/preview';

/**
 * `/visits/:id` — one visit on its own page.
 *
 * The officer needs this: their list links to it, and the twenty-four hour
 * correction lives here. Every other role already reads a visit in full from
 * the visits log, which opens it beside the rest of the programme's work with
 * the administrator's own controls; rebuilding that as a page would be
 * redesigning their workflow to no purpose, which this task is not for.
 *
 * So they are sent to the surface they already use, rather than shown a
 * thinner copy of it.
 */
export function VisitDetailByRole({ id }: { id: string }) {
  const { role, hydrated } = usePreview();
  if (!hydrated) return null;
  if (role === 'officer') return <OfficerVisitDetail id={id} />;
  return (
    <UnavailableState title="Open this visit from the visits log">
      The log lists every visit in your scope and opens each one in full, beside the controls that
      are yours. <Link href="/visits">Go to the visits log</Link>.
    </UnavailableState>
  );
}
