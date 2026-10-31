'use client';

import { type StaffInvitationView, staffInvitationSchema } from '@agri-erp/shared';
import { useCallback, useEffect, useState } from 'react';

import { formatJubaTime } from '@/lib/admin/access-view';
import {
  StaffAccessError,
  inviteStaff,
  listStaffInvitations,
  revokeStaffInvitation,
} from '@/lib/admin/staff-access-api';
import { useLocationNames } from '@/lib/portal/locations';

import { Badge, Button, Card, Field, Input, Notice, Select } from '../ui';

/**
 * STAFF INVITATIONS (2026-10-28, lane-security). Invite someone to a staff
 * role by email; they open the link, choose their own password and the
 * account is created then. Nobody else ever knows the password. The link
 * expires after 7 days and can be withdrawn before it is used.
 *
 * The server decides everything (staff.manage, over the state for a
 * state-scoped role); this screen shows what it answers. If the email could
 * not be sent, the link is shown once so it can be passed on another way.
 */

const ROLE_LABELS = {
  admin: 'Administrator',
  supervisor: 'Supervisor (one state)',
  read_only: 'Read-only (one state)',
} as const;

const STATUS_TONE = {
  pending: 'nile',
  accepted: 'leaf',
  expired: 'neutral',
  revoked: 'clay',
} as const;

const STATUS_LABEL = {
  pending: 'Waiting',
  accepted: 'Accepted',
  expired: 'Expired',
  revoked: 'Withdrawn',
} as const;

type Role = keyof typeof ROLE_LABELS;

export function StaffInvitations() {
  const locations = useLocationNames(true);
  const [rows, setRows] = useState<StaffInvitationView[] | null>(null);
  const [loadError, setLoadError] = useState<string | undefined>();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<Role>('supervisor');
  const [stateId, setStateId] = useState('');
  const [fields, setFields] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | undefined>();
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState<StaffInvitationView | null>(null);

  const load = useCallback(async () => {
    try {
      setRows(await listStaffInvitations());
      setLoadError(undefined);
    } catch (e) {
      // 403: this account may not manage staff. Say nothing more.
      setLoadError(
        e instanceof StaffAccessError && e.status === 403
          ? 'forbidden'
          : 'Invitations could not be loaded. Try again in a moment.',
      );
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  if (loadError === 'forbidden') return null;

  const submit = async () => {
    const input = {
      name,
      email,
      role,
      ...(role === 'admin' ? {} : stateId ? { state_id: stateId } : {}),
    };
    const parsed = staffInvitationSchema.safeParse(input);
    if (!parsed.success) {
      const next: Record<string, string> = {};
      for (const issue of parsed.error.issues) next[String(issue.path[0])] = issue.message;
      setFields(next);
      return;
    }
    setFields({});
    setError(undefined);
    setBusy(true);
    try {
      const created = await inviteStaff(parsed.data);
      setSent(created);
      setName('');
      setEmail('');
      await load();
    } catch (e) {
      if (e instanceof StaffAccessError) {
        setFields(e.fields ?? {});
        setError(e.message);
      } else {
        setError('The invitation could not be sent. Try again in a moment.');
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card padded>
      <h2 className="label">Invite staff</h2>
      <p className="small muted" style={{ marginBottom: 'var(--s-3)' }}>
        They get a one-time email link, valid for 7 days, and choose their own password.
      </p>

      <div style={{ display: 'grid', gap: 'var(--s-4)', maxWidth: '32rem' }}>
        <Field label="Name" error={fields.name}>
          {(ids) => <Input {...ids} value={name} onChange={(e) => setName(e.target.value)} />}
        </Field>
        <Field label="Email address" error={fields.email}>
          {(ids) => (
            <Input
              {...ids}
              type="email"
              autoComplete="off"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          )}
        </Field>
        <Field label="Role" error={fields.role}>
          {(ids) => (
            <Select {...ids} value={role} onChange={(e) => setRole(e.target.value as Role)}>
              {(Object.keys(ROLE_LABELS) as Role[]).map((r) => (
                <option key={r} value={r}>
                  {ROLE_LABELS[r]}
                </option>
              ))}
            </Select>
          )}
        </Field>
        {role !== 'admin' ? (
          <Field label="State" error={fields.state_id} hint="They see only this state.">
            {(ids) => (
              <Select {...ids} value={stateId} onChange={(e) => setStateId(e.target.value)}>
                <option value="">Choose a state…</option>
                {locations.states.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </Select>
            )}
          </Field>
        ) : (
          <p className="small muted">
            Administrators set up two-step sign-in when they first sign in.
          </p>
        )}
        {error ? <Notice kind="error">{error}</Notice> : null}
        <div>
          <Button variant="primary" disabled={busy} onClick={() => void submit()}>
            {busy ? 'Sending…' : 'Send invitation'}
          </Button>
        </div>
      </div>

      {sent ? (
        <div style={{ marginTop: 'var(--s-4)' }}>
          {sent.email_sent ? (
            <Notice kind="success" title="Invitation sent">
              <p className="small">
                An email went to {sent.email_hint}. The link expires{' '}
                {formatJubaTime(sent.expires_at)}.
              </p>
            </Notice>
          ) : (
            <Notice kind="warn" title="The email could not be sent">
              <p className="small">
                The invitation exists, but the email did not go. Pass this link to {sent.name}{' '}
                yourself, privately. It is shown only now.
              </p>
              <p className="small" style={{ wordBreak: 'break-all' }}>
                <code>{sent.link}</code>
              </p>
            </Notice>
          )}
        </div>
      ) : null}

      <h3 className="label" style={{ marginTop: 'var(--s-5)' }}>
        Invitations
      </h3>
      {loadError ? <Notice kind="error">{loadError}</Notice> : null}
      {rows && rows.length === 0 ? <p className="small muted">No invitations yet.</p> : null}
      <ul style={{ listStyle: 'none', padding: 0, display: 'grid', gap: 'var(--s-2)' }}>
        {(rows ?? []).map((r) => (
          <li
            key={r.id}
            style={{
              display: 'flex',
              flexWrap: 'wrap',
              gap: 'var(--s-2)',
              alignItems: 'center',
              justifyContent: 'space-between',
              borderBottom: '1px solid var(--line, #ddd)',
              paddingBottom: 'var(--s-2)',
            }}
          >
            <span>
              <strong>{r.name}</strong> <span className="small muted">{r.email_hint}</span>
              <br />
              <span className="small">
                {ROLE_LABELS[r.role]}
                {r.state_id ? ` · ${locations.state(r.state_id) ?? r.state_id}` : ''} · invited{' '}
                {formatJubaTime(r.created_at)}
                {r.invited_by_name ? ` by ${r.invited_by_name}` : ''}
              </span>
            </span>
            <span style={{ display: 'flex', gap: 'var(--s-2)', alignItems: 'center' }}>
              <Badge tone={STATUS_TONE[r.status]}>{STATUS_LABEL[r.status]}</Badge>
              {r.status === 'pending' ? (
                <Button
                  size="small"
                  variant="ghost"
                  onClick={() => {
                    void revokeStaffInvitation(r.id)
                      .then(load)
                      .catch(() => setError('The invitation could not be withdrawn.'));
                  }}
                >
                  Withdraw
                </Button>
              ) : null}
            </span>
          </li>
        ))}
      </ul>
    </Card>
  );
}
