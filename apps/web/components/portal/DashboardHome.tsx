'use client';

import { usePreview } from '@/lib/preview';

import { AdminOverview } from './AdminOverview';
import { Overview } from './Overview';

/**
 * WHICH OVERVIEW /dashboard SHOWS (2026-10-28). Staff see the administration
 * overview -- accounts, marketplace activity, open cases and system alerts --
 * which CORWADO's specification makes the Overview tab. An extension officer
 * keeps the programme overview of their own caseload, which is their job; staff
 * reach the same programme figures at /reports/programme. The role only decides
 * which screen is drawn: each one's routes enforce their own access.
 */
export function DashboardHome() {
  const { role, hydrated } = usePreview();
  if (!hydrated) return null;
  return role === 'officer' ? <Overview /> : <AdminOverview />;
}
