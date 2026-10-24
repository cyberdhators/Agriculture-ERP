import type { Metadata } from 'next';

import { SettingsAdmin } from '@/components/admin/settings/SettingsAdmin';

export const metadata: Metadata = { title: 'Settings' };

/** 2026-10-25: Settings, phase 1 -- administrators holding Manage settings. */
export default function AdminSettingsPage() {
  return <SettingsAdmin />;
}
