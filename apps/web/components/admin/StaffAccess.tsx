'use client';

import {
  ORDINARY_PRESETS,
  PERMISSION_LABELS,
  PRESET_DESCRIPTIONS,
  PRESET_LABELS,
  type StaffPreset,
} from '@agri-erp/shared';
import { type ReactNode, useCallback, useEffect, useState } from 'react';

import { formatJubaTime } from '@/lib/admin/access-view';
import {
  type Grant,
  type MyAccess,
  StaffAccessError,
  type StaffWithGrants,
  grantPreset,
  grantSuperAdmin,
  listStaffAccess,
  myAccess,
  resetMfa,
  revokeGrant,
  revokeSessions,
  revokeSuperAdmin,
} from '@/lib/admin/staff-access-api';
import { useLocationNames } from '@/lib/portal/locations';

import {
  Button,
  Checkbox,
  Dialog,
  Field,
  Input,
  Notice,
  PageHeader,
  PasswordInput,
  Select,
  Textarea,
} from '../ui';
import { DataTable, LoadingState, UnavailableState } from '../ui/data';
import styles from './admin.module.css';

/**
 * STAFF AND PERMISSIONS (2026-10-19). Who holds which preset, where, and the
 * Super Admin delegation.
 *
 * THE SERVER DECIDES EVERYTHING. This screen offers an action only when
 * /api/admin/staff-access/me says the caller holds the permission for it, but
 * every route checks again (requirePermission) -- hiding a button is a
 * courtesy, not the control. Every change asks for a reason, which is kept in
 * the audit trail. Appointing or removing a Super Admin also asks for the
 * caller's own password and an explicit confirmation.
 */

const errorText = (error: unknown): string => {
  if (error instanceof StaffAccessError) {
    const fields = error.fields ? Object.values(error.fields) : [];
    return fields.length > 0 ? `${error.message} ${fields.join(' ')}` : error.message;
  }
  return 'The request could not be completed. Try again in a moment.';
};

/** A dialog whose one button runs a request, showing the server's refusal in its words. */
function ActionDialog({
  open,
  title,
  submitLabel,
  danger,
  canSubmit = true,
  onClose,
  onSubmit,
  children,
}: {
  open: boolean;
  title: string;
  submitLabel: string;
  danger?: boolean;
  canSubmit?: boolean;
  onClose: () => void;
  onSubmit: () => Promise<void>;
  children: ReactNode;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | undefined>();
  useEffect(() => {
    if (open) setError(undefined);
  }, [open]);
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={title}
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button
            variant={danger ? 'danger' : 'primary'}
            disabled={busy || !canSubmit}
            onClick={() => {
              setBusy(true);
              setError(undefined);
              onSubmit()
                .then(onClose)
                .catch((e: unknown) => setError(errorText(e)))
                .finally(() => setBusy(false));
            }}
          >
            {busy ? 'Working…' : submitLabel}
          </Button>
        </>
      }
    >
      {children}
      {error ? (
        <Notice kind="error" title="Not changed">
          <p className="small">{error}</p>
        </Notice>
      ) : null}
    </Dialog>
  );
}

function ReasonField({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <Field label="Reason" hint="Kept in the audit trail. At least five characters.">
      {(ids) => (
        <Textarea {...ids} rows={3} value={value} onChange={(e) => onChange(e.target.value)} />
      )}
    </Field>
  );
}

/** Password, optional authenticator code and the explicit confirmation. */
function ReauthFields({
  password,
  setPassword,
  code,
  setCode,
  confirm,
  setConfirm,
  confirmLabel,
}: {
  password: string;
  setPassword: (v: string) => void;
  code: string;
  setCode: (v: string) => void;
  confirm: boolean;
  setConfirm: (v: boolean) => void;
  confirmLabel: string;
}) {
  return (
    <>
      <Field
        label="Your password"
        hint="Your own password, checked again on the server. Your session is not changed."
      >
        {(ids) => (
          <PasswordInput
            {...ids}
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        )}
      </Field>
      <Field
        label="Authenticator code"
        optional
        hint="Only if your account has an authenticator app set up."
      >
        {(ids) => (
          <Input
            {...ids}
            inputMode="numeric"
            autoComplete="one-time-code"
            maxLength={6}
            value={code}
            onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
          />
        )}
      </Field>
      <Checkbox
        label={confirmLabel}
        checked={confirm}
        onChange={(e) => setConfirm(e.target.checked)}
      />
    </>
  );
}

type DialogState =
  | { kind: 'none' }
  | { kind: 'grant'; staff: StaffWithGrants }
  | { kind: 'revoke'; staff: StaffWithGrants; grant: Grant }
  | { kind: 'appoint'; staff: StaffWithGrants | null }
  | { kind: 'unappoint'; staff: StaffWithGrants; grant: Grant }
  | { kind: 'sessions'; staff: StaffWithGrants }
  | { kind: 'mfa'; staff: StaffWithGrants };

export function StaffAccess() {
  const [me, setMe] = useState<MyAccess | null>(null);
  const [staff, setStaff] = useState<StaffWithGrants[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<{ status: number; message: string } | undefined>();
  const [attempt, setAttempt] = useState(0);
  const [dialog, setDialog] = useState<DialogState>({ kind: 'none' });
  const locations = useLocationNames(true);

  // Form state, reset whenever a dialog opens.
  const [preset, setPreset] = useState<StaffPreset>('analyst');
  const [scope, setScope] = useState<'platform' | 'states'>('states');
  const [stateIds, setStateIds] = useState<string[]>([]);
  const [reason, setReason] = useState('');
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [confirm, setConfirm] = useState(false);
  const [appointee, setAppointee] = useState('');

  const open = useCallback((next: DialogState) => {
    setPreset('analyst');
    setScope('states');
    setStateIds([]);
    setReason('');
    setPassword('');
    setCode('');
    setConfirm(false);
    setAppointee('');
    setDialog(next);
  }, []);
  const close = useCallback(() => {
    setPassword('');
    setDialog({ kind: 'none' });
  }, []);

  useEffect(() => {
    let live = true;
    setLoading(true);
    myAccess()
      .then(async (access) => {
        if (!live) return;
        setMe(access);
        const canManage = access.permissions.some((p) => p.key === 'staff.manage');
        setStaff(canManage ? await listStaffAccess() : []);
        if (live) setError(undefined);
      })
      .catch((e: unknown) => {
        if (!live) return;
        setError({
          status: e instanceof StaffAccessError ? e.status : 0,
          message: errorText(e),
        });
      })
      .finally(() => live && setLoading(false));
    return () => {
      live = false;
    };
  }, [attempt]);

  const reload = () => setAttempt((n) => n + 1);
  const stateName = (id: string) => locations.state(id) ?? id;
  const scopeText = (g: Pick<Grant, 'scope' | 'state_ids'>) =>
    g.scope === 'platform' ? 'Whole platform' : g.state_ids.map(stateName).join(', ');

  const manage = me?.permissions.find((p) => p.key === 'staff.manage');

  if (loading) {
    return (
      <div className={styles.page}>
        <PageHeader title="Staff and permissions" />
        <LoadingState rows={4} label="Loading staff permissions" />
      </div>
    );
  }

  if (error || !me) {
    return (
      <div className={styles.page}>
        <PageHeader title="Staff and permissions" />
        <Notice kind="error" title="Could not load this information">
          <p className="small">
            {error?.message}{' '}
            <Button variant="ghost" size="small" onClick={reload}>
              Try again
            </Button>
          </p>
        </Notice>
      </div>
    );
  }

  if (!manage) {
    return (
      <div className={styles.page}>
        <PageHeader title="Staff and permissions" />
        <UnavailableState title="Not available to your account">
          Needs the Administrator preset.
        </UnavailableState>
      </div>
    );
  }

  const superAdmins = staff.filter((s) => s.grants.some((g) => g.preset === 'super_admin'));
  const admins = staff.filter((s) => s.role === 'admin');
  const self = staff.find((s) => s.id === me.user_id) ?? null;

  return (
    <div className={styles.page}>
      <PageHeader
        title="Staff and permissions"
        subtitle="Presets grant permissions; the role alone grants none."
      />

      {/* ---- Your own access ------------------------------------------- */}
      <section className={styles.section} aria-labelledby="my-access">
        <div className={styles.sectionHead}>
          <h2 id="my-access">Your access</h2>
        </div>
        <ul className="small">
          {me.permissions.map((p) => (
            <li key={p.key}>
              {PERMISSION_LABELS[p.key]} —{' '}
              {p.platform ? 'whole platform' : p.state_ids.map(stateName).join(', ')}
            </li>
          ))}
        </ul>
        {me.role === 'admin' && !me.is_super_admin ? (
          <p className="small muted">
            As an administrator you hold every permission except appointing a Super Admin, without
            needing a preset.
          </p>
        ) : null}
      </section>

      {/* ---- Super Admin ----------------------------------------------- */}
      <section className={styles.section} aria-labelledby="super-admins">
        <div className={styles.sectionHead}>
          <h2 id="super-admins">Super Admins</h2>
          {me.is_super_admin ? (
            <Button size="small" onClick={() => open({ kind: 'appoint', staff: null })}>
              Appoint a Super Admin
            </Button>
          ) : null}
        </div>
        {!me.super_admin_exists ? (
          <Notice kind="info" title="No Super Admin has been appointed">
            <p className="small">
              Until one exists, nobody can appoint Super Admins. An administrator may make
              themselves the first, by confirming their password.{' '}
              {me.can_bootstrap_super_admin && self ? (
                <Button size="small" onClick={() => open({ kind: 'appoint', staff: self })}>
                  Make me the first Super Admin
                </Button>
              ) : null}
            </p>
          </Notice>
        ) : (
          <ul className="small">
            {superAdmins.map((s) => {
              const grant = s.grants.find((g) => g.preset === 'super_admin')!;
              return (
                <li key={s.id}>
                  {s.name} — since {formatJubaTime(grant.granted_at)}{' '}
                  {me.is_super_admin ? (
                    <Button
                      variant="ghost"
                      size="small"
                      onClick={() => open({ kind: 'unappoint', staff: s, grant })}
                    >
                      Revoke
                    </Button>
                  ) : null}
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {/* ---- Everyone --------------------------------------------------- */}
      <DataTable
        caption="Staff accounts and their presets"
        captionVisible
        rows={staff}
        rowKey={(s) => s.id}
        columns={[
          { key: 'name', header: 'Name', rowHeader: true, render: (s) => s.name },
          {
            key: 'role',
            header: 'Role and home',
            render: (s) =>
              `${s.role.replace('_', '-')}${s.state_id ? `, ${stateName(s.state_id)}` : ''}`,
          },
          {
            key: 'presets',
            header: 'Presets',
            render: (s) =>
              s.grants.length === 0 ? (
                <span className="muted">None (the role alone grants no permission)</span>
              ) : (
                <ul className={styles.grantList}>
                  {s.grants.map((g) => (
                    <li key={g.id}>
                      <strong>{PRESET_LABELS[g.preset]}</strong> — {scopeText(g)}
                      {g.preset !== 'super_admin' && s.id !== me.user_id ? (
                        <>
                          {' '}
                          <Button
                            variant="ghost"
                            size="small"
                            onClick={() => open({ kind: 'revoke', staff: s, grant: g })}
                          >
                            Revoke
                          </Button>
                        </>
                      ) : null}
                    </li>
                  ))}
                </ul>
              ),
          },
          {
            key: 'activity',
            header: 'Last activity',
            nowrap: true,
            render: (s) => formatJubaTime(s.last_activity_at),
          },
          {
            key: 'actions',
            header: 'Actions',
            printHidden: true,
            render: (s) => (
              <span className={styles.rowActions}>
                {s.id !== me.user_id ? (
                  <Button
                    variant="secondary"
                    size="small"
                    onClick={() => open({ kind: 'grant', staff: s })}
                  >
                    Add preset
                  </Button>
                ) : null}
                {me.is_super_admin ? (
                  <Button
                    variant="ghost"
                    size="small"
                    onClick={() => open({ kind: 'sessions', staff: s })}
                  >
                    Sign out everywhere
                  </Button>
                ) : null}
                {me.is_super_admin && s.id !== me.user_id ? (
                  <Button
                    variant="ghost"
                    size="small"
                    onClick={() => open({ kind: 'mfa', staff: s })}
                  >
                    Reset two-step sign-in
                  </Button>
                ) : null}
              </span>
            ),
          },
        ]}
      />

      {/* ---- Dialogs ---------------------------------------------------- */}
      <ActionDialog
        open={dialog.kind === 'grant'}
        title={dialog.kind === 'grant' ? `Add a preset for ${dialog.staff.name}` : ''}
        submitLabel="Add preset"
        onClose={close}
        onSubmit={async () => {
          if (dialog.kind !== 'grant') return;
          await grantPreset({
            user_id: dialog.staff.id,
            preset: preset,
            scope,
            ...(scope === 'states' ? { state_ids: stateIds } : {}),
            reason,
          });
          reload();
        }}
      >
        <Field label="Preset" hint={PRESET_DESCRIPTIONS[preset]}>
          {(ids) => (
            <Select
              {...ids}
              value={preset}
              onChange={(e) => setPreset(e.target.value as StaffPreset)}
            >
              {ORDINARY_PRESETS.map((p) => (
                <option key={p} value={p}>
                  {PRESET_LABELS[p]}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field label="Applies to">
          {(ids) => (
            <Select
              {...ids}
              value={scope}
              onChange={(e) => setScope(e.target.value as 'platform' | 'states')}
            >
              <option value="states">Chosen states</option>
              {manage.platform ? <option value="platform">The whole platform</option> : null}
            </Select>
          )}
        </Field>
        {scope === 'states' ? (
          <fieldset className={styles.stateChoices}>
            <legend className="small">States</legend>
            {locations.states
              .filter((st) => manage.platform || manage.state_ids.includes(st.id))
              .map((st) => (
                <Checkbox
                  key={st.id}
                  label={st.name}
                  checked={stateIds.includes(st.id)}
                  onChange={(e) =>
                    setStateIds((cur) =>
                      e.target.checked ? [...cur, st.id] : cur.filter((x) => x !== st.id),
                    )
                  }
                />
              ))}
          </fieldset>
        ) : null}
        <ReasonField value={reason} onChange={setReason} />
      </ActionDialog>

      <ActionDialog
        open={dialog.kind === 'revoke'}
        title={
          dialog.kind === 'revoke'
            ? `Revoke ${PRESET_LABELS[dialog.grant.preset]} from ${dialog.staff.name}`
            : ''
        }
        submitLabel="Revoke preset"
        danger
        onClose={close}
        onSubmit={async () => {
          if (dialog.kind !== 'revoke') return;
          await revokeGrant(dialog.grant.id, { reason });
          reload();
        }}
      >
        <ReasonField value={reason} onChange={setReason} />
      </ActionDialog>

      <ActionDialog
        open={dialog.kind === 'appoint'}
        title={
          dialog.kind === 'appoint' && dialog.staff
            ? 'Make yourself the first Super Admin'
            : 'Appoint a Super Admin'
        }
        submitLabel="Appoint Super Admin"
        danger
        canSubmit={confirm && password.length > 0}
        onClose={close}
        onSubmit={async () => {
          if (dialog.kind !== 'appoint') return;
          const userId = dialog.staff?.id ?? appointee;
          await grantSuperAdmin({
            user_id: userId,
            reason,
            password,
            confirm: true,
            ...(code ? { totp_code: code } : {}),
          });
          reload();
        }}
      >
        <p className="small">
          A Super Admin can do everything, including appointing other Super Admins, ending anyone’s
          sessions and exporting identifiable data.
        </p>
        {dialog.kind === 'appoint' && !dialog.staff ? (
          <Field label="Administrator to appoint">
            {(ids) => (
              <Select {...ids} value={appointee} onChange={(e) => setAppointee(e.target.value)}>
                <option value="">Choose an administrator</option>
                {admins
                  .filter((a) => !superAdmins.includes(a))
                  .map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.name}
                    </option>
                  ))}
              </Select>
            )}
          </Field>
        ) : null}
        <ReasonField value={reason} onChange={setReason} />
        <ReauthFields
          password={password}
          setPassword={setPassword}
          code={code}
          setCode={setCode}
          confirm={confirm}
          setConfirm={setConfirm}
          confirmLabel="I confirm this account becomes a Super Admin."
        />
      </ActionDialog>

      <ActionDialog
        open={dialog.kind === 'unappoint'}
        title={dialog.kind === 'unappoint' ? `Revoke Super Admin from ${dialog.staff.name}` : ''}
        submitLabel="Revoke Super Admin"
        danger
        canSubmit={confirm && password.length > 0}
        onClose={close}
        onSubmit={async () => {
          if (dialog.kind !== 'unappoint') return;
          await revokeSuperAdmin(dialog.grant.id, {
            reason,
            password,
            confirm: true,
            ...(code ? { totp_code: code } : {}),
          });
          reload();
        }}
      >
        <p className="small">The last active Super Admin cannot be revoked.</p>
        <ReasonField value={reason} onChange={setReason} />
        <ReauthFields
          password={password}
          setPassword={setPassword}
          code={code}
          setCode={setCode}
          confirm={confirm}
          setConfirm={setConfirm}
          confirmLabel="I confirm this account stops being a Super Admin."
        />
      </ActionDialog>

      <ActionDialog
        open={dialog.kind === 'sessions'}
        title={dialog.kind === 'sessions' ? `Sign ${dialog.staff.name} out everywhere` : ''}
        submitLabel="End all sessions"
        danger
        canSubmit={confirm}
        onClose={close}
        onSubmit={async () => {
          if (dialog.kind !== 'sessions') return;
          await revokeSessions(dialog.staff.id, { reason, confirm: true });
        }}
      >
        <p className="small">
          Ends every session on every device. The account is not disabled: they can sign in again
          with their password. To end access for good, remove the account.
        </p>
        <ReasonField value={reason} onChange={setReason} />
        <Checkbox
          label="I confirm all of this account’s sessions end now."
          checked={confirm}
          onChange={(e) => setConfirm(e.target.checked)}
        />
      </ActionDialog>

      {/* 2026-10-28: a lost or replaced phone. Super Admins only, never yourself. */}
      <ActionDialog
        open={dialog.kind === 'mfa'}
        title={dialog.kind === 'mfa' ? `Reset two-step sign-in for ${dialog.staff.name}` : ''}
        submitLabel="Reset two-step sign-in"
        danger
        canSubmit={confirm && password.length > 0}
        onClose={close}
        onSubmit={async () => {
          if (dialog.kind !== 'mfa') return;
          await resetMfa(dialog.staff.id, {
            reason,
            password,
            confirm: true,
            ...(code ? { totp_code: code } : {}),
          });
        }}
      >
        <p className="small">
          Removes their authenticator app and signs them out everywhere. Next time they sign in they
          set up a new one. Use this when a phone is lost or replaced, after checking it is really
          them who is asking.
        </p>
        <ReasonField value={reason} onChange={setReason} />
        <ReauthFields
          password={password}
          setPassword={setPassword}
          code={code}
          setCode={setCode}
          confirm={confirm}
          setConfirm={setConfirm}
          confirmLabel="I confirm their authenticator is removed and they are signed out."
        />
      </ActionDialog>
    </div>
  );
}
