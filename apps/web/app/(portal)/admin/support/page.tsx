import type { Metadata } from 'next';

import { SupportInbox } from '@/components/support/SupportInbox';

export const metadata: Metadata = { title: 'Support messages' };

/** 2026-10-21: "Contact CORWADO" messages, marked done by staff. */
export default function AdminSupportPage() {
  return <SupportInbox />;
}
