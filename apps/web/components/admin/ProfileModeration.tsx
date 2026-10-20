'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';

import type { SanctionKind } from '@agri-erp/shared';

import { formatDate } from '@/lib/format';

import { ProfilePhoto } from '../public-profile/ProfileCard';
import { Button, Field, Notice, Stamp, Textarea } from '../ui';
import { ConfirmationDialog } from '../ui/feedback';

/**
 * THE PUBLIC PROFILE, AS STAFF MODERATING AN ACCOUNT SEE IT (2026-10-23,
 * public profiles v2). Inside the Account box on a farmer's record and on a
 * buyer: the profile's status, name and photo, a link to it when published,
 * and "Remove photo" with a reason (kept in the audit trail). Staff never
 * edit or publish a profile; that is the owner's alone.
 *
 * Administrators holding "Moderate content and listings"; anyone else gets
 * 403 from the route and sees nothing here.
 */

const REASON_MIN = 5;

interface Snapshot {
  exists: boolean;
  public_id?: string;
  status?: 'draft' | 'published' | 'unpublished';
  published_at?: string | null;
  display_name?: string | null;
  has_photo?: boolean;
  photo_url?: string | null;
}

const STATUS_LABEL = { draft: 'Draft', published: 'Published', unpublished: 'Unpublished' };

export function ProfileModeration({
  kind,
  id,
  compact = false,
}: {
  kind: SanctionKind;
  id: string;
  compact?: boolean;
}) {
  const [snap, setSnap] = useState<Snapshot | null>(null);
  const [hidden, setHidden] = useState(false);
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldError, setFieldError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch(
        `/api/admin/accounts/public-profile?kind=${kind}&id=${encodeURIComponent(id)}`,
        { cache: 'no-store' },
      );
      if (res.status === 403 || res.status === 404) {
        setHidden(true);
        return;
      }
      const body = (await res.json().catch(() => ({}))) as { data?: Snapshot };
      if (body.data) setSnap(body.data);
    } catch {
      setHidden(true);
    }
  }, [kind, id]);

  useEffect(() => {
    void load();
  }, [load]);

  if (hidden || !snap) return null;
  if (!snap.exists) {
    return compact ? null : <p className="small muted">No public profile.</p>;
  }

  const remove = async () => {
    const trimmed = reason.trim();
    if (trimmed.length < REASON_MIN) {
      setFieldError(`Give a reason of at least ${REASON_MIN} characters.`);
      return;
    }
    setBusy(true);
    setError(null);
    setFieldError(null);
    try {
      const res = await fetch('/api/admin/accounts/public-profile/remove-photo', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ kind, id, reason: trimmed }),
      });
      const body = (await res.json().catch(() => ({}))) as {
        error?: { message?: string; fields?: Record<string, string> };
      };
      if (!res.ok) {
        setFieldError(body.error?.fields?.reason ?? null);
        setError(body.error?.message ?? `The request failed (${res.status}).`);
        return;
      }
      setOpen(false);
      setReason('');
      await load();
    } catch {
      setError('The server could not be reached. Check the connection.');
    } finally {
      setBusy(false);
    }
  };

  const status = snap.status ?? 'draft';
  const name = snap.display_name ?? '';

  return (
    <div style={{ display: 'grid', gap: 'var(--s-2)', justifyItems: 'start' }}>
      {compact ? null : (
        <>
          <p className="label">Public profile</p>
          <div style={{ display: 'flex', gap: 'var(--s-3)', alignItems: 'center' }}>
            <ProfilePhoto name={name} url={snap.photo_url ?? null} small />
            <div style={{ display: 'grid', gap: 4 }}>
              <span dir="auto">{name || 'No name saved'}</span>
              <span className="small">
                <Stamp kind={status === 'published' ? 'info' : 'neutral'}>
                  {STATUS_LABEL[status]}
                </Stamp>
                {snap.published_at && status === 'published'
                  ? ` since ${formatDate(snap.published_at)}`
                  : ''}
              </span>
              {status === 'published' && snap.public_id ? (
                <Link className="small" href={`/market/p/${snap.public_id}`}>
                  View public profile
                </Link>
              ) : null}
            </div>
          </div>
        </>
      )}
      {snap.has_photo ? (
        <Button
          size="small"
          variant="secondary"
          onClick={() => {
            setReason('');
            setError(null);
            setFieldError(null);
            setOpen(true);
          }}
        >
          Remove photo
        </Button>
      ) : null}
      <ConfirmationDialog
        open={open}
        onCancel={() => setOpen(false)}
        onConfirm={() => void remove()}
        title="Remove this profile photo?"
        consequence="The photo leaves the public profile at once and the profile shows initials instead. The owner can add another photo. Nothing else on the profile changes."
        confirmLabel="Remove photo"
        destructive
        busy={busy}
      >
        {error && !fieldError ? <Notice kind="error">{error}</Notice> : null}
        <Field
          label="Reason"
          hint={`At least ${REASON_MIN} characters, up to 500. Kept in the audit trail.`}
          error={fieldError ?? undefined}
        >
          {(ids) => (
            <Textarea
              {...ids}
              rows={3}
              maxLength={500}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
            />
          )}
        </Field>
      </ConfirmationDialog>
    </div>
  );
}
