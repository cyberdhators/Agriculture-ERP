import type { Metadata } from 'next';

import { Organisations } from '@/components/teams/Organisations';

export const metadata: Metadata = { title: 'Organisations' };

/** 2026-10-27 (team access): the account's organisations and invitations. */
export default function Page() {
  return <Organisations side="buyer" language="en" />;
}
