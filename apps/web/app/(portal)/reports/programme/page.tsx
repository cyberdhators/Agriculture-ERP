import type { Metadata } from 'next';

import { Overview } from '@/components/portal/Overview';

export const metadata: Metadata = { title: 'Farmer verification programme' };

/**
 * 2026-10-28: the national programme overview -- farmer registration,
 * verification, reach and the review queue, from GET /api/reports/summary --
 * moved here from /dashboard, where the administration overview is now the
 * headline. Every role the summary route accepts may open it; the figures are
 * scoped by the server as before.
 */
export default function ProgrammeOverviewPage() {
  return <Overview />;
}
