import type { Metadata } from 'next';

import { InviteAccept } from '@/components/teams/InviteAccept';

export const metadata: Metadata = { title: 'Invitation' };

/** 2026-10-27 (team access): the page an organisation's invitation link opens. */
export default async function Page({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  // 2026-10-31: the member look (`.shop`), as on the sign-in pages.
  return (
    <div className="shop">
      <InviteAccept token={token} />
    </div>
  );
}
