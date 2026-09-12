'use client';

import type { ReactNode } from 'react';

import { ROLE_LABELS, canEdit, usePreview } from '@/lib/preview';

import { ButtonLink, EmptyState } from '../ui';

/**
 * Screens that create, edit or remove are for administrators. This is the
 * client-side half of the authorisation rule: it keeps the form out of an
 * officer's way. The server half is requireRole on every route (B3), which is
 * the half that actually protects anything.
 */
export function RequireEditor({
  children,
  backHref,
  backLabel,
}: {
  children: ReactNode;
  backHref: string;
  backLabel: string;
}) {
  const { role, hydrated } = usePreview();
  if (!hydrated) return null;
  if (canEdit(role)) return <>{children}</>;
  return (
    <EmptyState
      error
      title="Only a programme administrator can do this"
      body={`You are signed in as ${ROLE_LABELS[role]}. Creating, editing and removing entries is an administrator action.`}
      actions={<ButtonLink href={backHref}>{backLabel}</ButtonLink>}
    />
  );
}
