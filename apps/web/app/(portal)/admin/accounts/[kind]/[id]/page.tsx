import type { Metadata } from 'next';
import { notFound } from 'next/navigation';

import { ACCOUNT_DETAIL_KINDS, type AccountDetailKind } from '@agri-erp/shared';

import { AccountDetail } from '@/components/admin/AccountDetail';

export const metadata: Metadata = { title: 'Account' };

/** 2026-10-28: one account as authorised staff see it. */
export default async function AdminAccountPage({
  params,
}: {
  params: Promise<{ kind: string; id: string }>;
}) {
  const { kind, id } = await params;
  if (!(ACCOUNT_DETAIL_KINDS as readonly string[]).includes(kind) || kind === 'organisation') {
    notFound();
  }
  return <AccountDetail kind={kind as AccountDetailKind} id={id} />;
}
