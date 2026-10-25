'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';

import type { AccountDetailKind, AdminAccountDetail } from '@agri-erp/shared';

import {
  actorLabel,
  advisoryLabel,
  eventLabel,
  formatDateTime,
  publicationLabel,
  signInLabel,
  statusLabel,
  statusStamp,
  verificationLabel,
  words,
} from '@/lib/admin/accounts-view';
import { formatPhone } from '@/lib/format';
import { useLocationNames } from '@/lib/portal/locations';

import { AccountSanction } from './AccountSanction';
import { Button, Card, EmptyState, Notice, PageHeader, Stamp } from '../ui';
import { LoadingState } from '../ui/data';

/**
 * ONE ACCOUNT, AS AUTHORISED STAFF SEE IT (2026-10-28; infographic "Profile
 * creation and visibility", panel 4, "Authorized admin view"). The profile,
 * contact-verified flags, the private contact MASKED (Reveal for staff who
 * assist users -- every reveal is in the audit trail), user activity, staff
 * actions, organisations, advisory status; Contact, Suspend, Disable and
 * Restore (Re-enable for a Super Admin). Passwords are never anywhere.
 */

interface Revealed {
  phone?: string;
  email?: string;
}

export function AccountDetail({ kind, id }: { kind: AccountDetailKind; id: string }) {
  const names = useLocationNames(true);
  const [detail, setDetail] = useState<AdminAccountDetail | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const [revealed, setRevealed] = useState<Revealed>({});
  const [revealError, setRevealError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setFailure(null);
    try {
      const res = await fetch(`/api/admin/accounts/${kind}/${encodeURIComponent(id)}`, {
        cache: 'no-store',
      });
      const body = (await res.json().catch(() => ({}))) as {
        data?: AdminAccountDetail;
        error?: { message?: string };
      };
      if (!res.ok || !body.data) {
        throw new Error(
          res.status === 404
            ? 'This account was not found. It may have been deleted.'
            : res.status === 403
              ? 'You need the "Assist users" or "Moderate content" permission to see accounts.'
              : (body.error?.message ?? `Not loaded (${res.status}).`),
        );
      }
      setDetail(body.data);
    } catch (e) {
      setFailure(e instanceof Error ? e.message : 'Not loaded.');
    }
  }, [kind, id]);

  useEffect(() => {
    void load();
  }, [load]);

  const reveal = async (field: 'phone' | 'email') => {
    setRevealError(null);
    try {
      const res = await fetch(`/api/admin/accounts/${kind}/${encodeURIComponent(id)}/reveal`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ field }),
      });
      const body = (await res.json().catch(() => ({}))) as {
        data?: { value: string };
        error?: { message?: string };
      };
      if (!res.ok || !body.data) throw new Error(body.error?.message ?? 'Not revealed.');
      setRevealed((r) => ({ ...r, [field]: body.data!.value }));
      void load(); // the reveal is now among the staff actions
    } catch (e) {
      setRevealError(e instanceof Error ? e.message : 'Not revealed.');
    }
  };

  if (failure) {
    return (
      <EmptyState
        error
        title="Account could not be loaded"
        body={failure}
        actions={<Button onClick={() => void load()}>Try again</Button>}
      />
    );
  }
  if (!detail) return <LoadingState rows={6} />;

  const { row, contacts, profile, standing } = detail;
  const state = row.state_id ? (names.state(row.state_id) ?? row.state_id) : null;
  const sanctionKind = detail.records.farmer_id ? 'farmer' : 'buyer';
  const sanctionId = detail.records.farmer_id ?? detail.records.buyer_id;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--s-6)' }}>
      <p className="small">
        <Link href="/admin/accounts">← Users and organizations</Link>
      </p>
      <PageHeader title={row.name} subtitle={`${signInLabel(row.sign_in)} · ID ${row.id}`} />

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--s-2)' }}>
        <Stamp kind={statusStamp(row.status)}>{statusLabel(row.status)}</Stamp>
        {contacts.phone_verified ? <Stamp kind="verified">Phone verified</Stamp> : null}
        {contacts.email_confirmed ? <Stamp kind="verified">Email confirmed</Stamp> : null}
        <Stamp kind={row.publication === 'published' ? 'verified' : 'neutral'}>
          {publicationLabel(row.publication)}
        </Stamp>
        <Stamp kind={row.advisory === 'approved' ? 'verified' : 'neutral'}>
          {advisoryLabel(row.advisory)}
        </Stamp>
      </div>

      <div
        style={{
          display: 'grid',
          gap: 'var(--s-4)',
          gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 320px), 1fr))',
        }}
      >
        <Card padded>
          <p className="label">Profile</p>
          <dl className="small" style={{ display: 'grid', gap: 6, margin: 0 }}>
            <div>
              <dt className="muted">Actor types</dt>
              <dd>{row.actor_types.map(actorLabel).join(', ') || '—'}</dd>
            </div>
            {profile?.profile_kind ? (
              <div>
                <dt className="muted">Kind of profile</dt>
                <dd>{words(profile.profile_kind)}</dd>
              </div>
            ) : null}
            <div>
              <dt className="muted">Location</dt>
              <dd>{state ?? '—'}</dd>
            </div>
            {row.farmer_number ? (
              <div>
                <dt className="muted">Farmer number</dt>
                <dd className="mono">{row.farmer_number}</dd>
              </div>
            ) : null}
            <div>
              <dt className="muted">Verification</dt>
              <dd>{verificationLabel(row)}</dd>
            </div>
            <div>
              <dt className="muted">Joined</dt>
              <dd>{formatDateTime(row.joined_at)}</dd>
            </div>
            <div>
              <dt className="muted">First sign-in · last active</dt>
              <dd>
                {formatDateTime(row.first_sign_in_at)} · {formatDateTime(row.last_active_at)}
              </dd>
            </div>
            {profile?.about ? (
              <div>
                <dt className="muted">About</dt>
                <dd dir="auto">{profile.about}</dd>
              </div>
            ) : null}
          </dl>
          {profile?.public_id && row.publication === 'published' ? (
            <p className="small" style={{ marginTop: 'var(--s-3)' }}>
              <Link href={`/market/p/${profile.public_id}`}>View public profile</Link>
            </p>
          ) : null}
        </Card>

        <Card padded>
          <p className="label">Private contact (authorised staff only)</p>
          <div className="small" style={{ display: 'grid', gap: 8 }}>
            {contacts.phone_masked ? (
              <div>
                Phone:{' '}
                <span className="mono">
                  {revealed.phone ? formatPhone(revealed.phone) : contacts.phone_masked}
                </span>{' '}
                {contacts.phone_verified ? '(verified)' : '(not verified)'}
                {revealed.phone ? (
                  <>
                    {' '}
                    · <a href={`tel:${revealed.phone}`}>Call</a> ·{' '}
                    <a href={`sms:${revealed.phone}`}>Text</a>
                  </>
                ) : contacts.can_reveal ? (
                  <>
                    {' '}
                    <Button size="small" variant="secondary" onClick={() => void reveal('phone')}>
                      Reveal to contact
                    </Button>
                  </>
                ) : null}
              </div>
            ) : (
              <div className="muted">No phone on this account.</div>
            )}
            {contacts.email_masked ? (
              <div>
                Email: <span>{revealed.email ?? contacts.email_masked}</span>{' '}
                {contacts.email_confirmed ? '(confirmed)' : '(not confirmed)'}
                {revealed.email ? (
                  <>
                    {' '}
                    · <a href={`mailto:${revealed.email}`}>Write</a>
                  </>
                ) : contacts.can_reveal ? (
                  <>
                    {' '}
                    <Button size="small" variant="secondary" onClick={() => void reveal('email')}>
                      Reveal to contact
                    </Button>
                  </>
                ) : null}
              </div>
            ) : row.sign_in === 'email' ? (
              <div className="muted">The email address could not be checked just now.</div>
            ) : null}
            <p className="muted">
              {contacts.can_reveal
                ? 'Revealing a contact is recorded in the audit trail with your name.'
                : 'Only staff who assist users can reveal a contact.'}{' '}
              Passwords are never visible.
            </p>
            {revealError ? <Notice kind="error">{revealError}</Notice> : null}
          </div>
        </Card>

        {sanctionId && detail.can_moderate ? (
          <AccountSanction
            kind={sanctionKind}
            id={sanctionId}
            canReenable={detail.can_reenable}
            onChange={() => void load()}
          />
        ) : standing ? (
          <Card padded>
            <p className="label">Account</p>
            <p className="small">
              {statusLabel(row.status)}. Suspending, disabling and restoring need the “Moderate
              content and listings” permission.
            </p>
          </Card>
        ) : null}
      </div>

      <div
        style={{
          display: 'grid',
          gap: 'var(--s-4)',
          gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 320px), 1fr))',
        }}
      >
        <Card padded>
          <p className="label">Organisations</p>
          {detail.records.buyer_organization || detail.organisations.length ? (
            <ul className="small" style={{ margin: 0, paddingInlineStart: 18 }}>
              {detail.records.buyer_organization ? (
                <li dir="auto">
                  {detail.records.buyer_organization.name} — buyer organisation,{' '}
                  {words(detail.records.buyer_organization.verification)}
                </li>
              ) : null}
              {detail.organisations.map((o) => (
                <li key={o.id} dir="auto">
                  <Link href={`/admin/organizations?q=${encodeURIComponent(o.name)}`}>
                    {o.name}
                  </Link>{' '}
                  — {words(o.role)}, {words(o.status)}
                </li>
              ))}
            </ul>
          ) : (
            <p className="small muted">No organisation.</p>
          )}
        </Card>

        <Card padded>
          <p className="label">User activity</p>
          {detail.timeline.length ? (
            <table className="small" style={{ width: '100%' }}>
              <thead>
                <tr>
                  <th style={{ textAlign: 'start' }}>Time</th>
                  <th style={{ textAlign: 'start' }}>Activity</th>
                </tr>
              </thead>
              <tbody>
                {detail.timeline.map((t, i) => (
                  <tr key={`${t.at}:${i}`}>
                    <td style={{ whiteSpace: 'nowrap' }}>{formatDateTime(t.at)}</td>
                    <td>{eventLabel(t.source, t.event)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <p className="small muted">No activity recorded.</p>
          )}
        </Card>

        <Card padded>
          <p className="label">Staff actions</p>
          {detail.staff_actions.length ? (
            <table className="small" style={{ width: '100%' }}>
              <thead>
                <tr>
                  <th style={{ textAlign: 'start' }}>Action</th>
                  <th style={{ textAlign: 'start' }}>Reason</th>
                  <th style={{ textAlign: 'start' }}>Time</th>
                </tr>
              </thead>
              <tbody>
                {detail.staff_actions.map((s, i) => (
                  <tr key={`${s.at}:${i}`}>
                    <td>
                      {words(s.action)}
                      {s.actor_name ? <span className="muted"> · {s.actor_name}</span> : null}
                    </td>
                    <td dir="auto">{s.reason ?? '—'}</td>
                    <td style={{ whiteSpace: 'nowrap' }}>{formatDateTime(s.at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <p className="small muted">No staff action on this account.</p>
          )}
        </Card>
      </div>
    </div>
  );
}
