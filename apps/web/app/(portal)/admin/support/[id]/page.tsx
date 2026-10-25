import type { Metadata } from 'next';

import { SupportCase } from '@/components/support/SupportCase';

export const metadata: Metadata = { title: 'Support case' };

/** 2026-10-28: one support case. */
export default async function SupportCasePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <SupportCase id={id} />;
}
