'use client';

import { useState } from 'react';

import {
  createOfficerSchema,
  createUserSchema,
  patchOfficerSchema,
  patchUserSchema,
  USER_ROLES,
} from '@agri-erp/shared';

import { Button, Dialog, Field, Input, Notice, PrefixedInput, Select } from '@/components/ui';
import {
  AdminApiError,
  createOfficer,
  createStaff,
  patchOfficer,
  patchStaff,
  LIVE_ADMIN,
  type Officer,
  type StaffUser,
} from '@/lib/admin/api';
import { PAYAM_NAMES, STATE_NAMES } from '@/lib/admin/fixtures';

export type AccountKind = 'staff' | 'officer';

const ROLE_LABEL: Record<string, string> = {
  admin: 'Administrator',
  supervisor: 'Supervisor',
  read_only: 'Read only',
};

const STATE_OPTIONS = Object.entries(STATE_NAMES);
const PAYAM_OPTIONS = Object.entries(PAYAM_NAMES);

type Values = {
  name: string;
  email: string;
  phone: string;
  password: string;
  role: string;
  state_id: string;
  payam_id: string;
  status: 'active' | 'inactive';
};

function initialValues(staff?: StaffUser, officer?: Officer): Values {
  return {
    name: staff?.name ?? officer?.name ?? '',
    email: '',
    phone: officer?.phone ?? '',
    password: '',
    role: staff?.role ?? 'supervisor',
    state_id: staff?.state_id ?? '',
    payam_id: officer?.payam_id ?? '',
    status: officer?.status ?? 'active',
  };
}

type FieldErrors = Partial<Record<keyof Values, string>>;

/**
 * Create or edit a staff account or an extension officer. Validated with the
 * same Zod schemas the API uses (`packages/shared`), so the form says exactly
 * what the server would. On save it calls the live B3 route when
 * `NEXT_PUBLIC_USE_LIVE_ADMIN=1`; otherwise it returns a locally-built record so
 * the screen can be exercised before a sign-in endpoint exists.
 */
export function AccountForm({
  kind,
  staff,
  officer,
  canSetPassword = true,
  onClose,
  onSavedStaff,
  onSavedOfficer,
}: {
  kind: AccountKind;
  staff?: StaffUser;
  officer?: Officer;
  /**
   * False when the account being edited is the signed-in administrator's own.
   * The specification says an administrator does not set their own password
   * through the administrative action, and no route offers a self-service
   * one — so the field is not rendered rather than rendered and refused.
   */
  canSetPassword?: boolean;
  onClose: () => void;
  onSavedStaff: (u: StaffUser) => void;
  onSavedOfficer: (o: Officer) => void;
}) {
  const editing = Boolean(staff ?? officer);
  const [values, setValues] = useState<Values>(initialValues(staff, officer));
  const [errors, setErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState<string | undefined>();
  const [busy, setBusy] = useState(false);

  const set = <K extends keyof Values>(key: K, value: Values[K]) =>
    setValues((v) => ({ ...v, [key]: value }));

  function validate(): Record<string, unknown> | null {
    let payload: Record<string, unknown>;
    let schema;
    if (kind === 'staff') {
      if (editing) {
        payload = {
          name: values.name,
          role: values.role,
          ...(values.role === 'admin' ? { state_id: null } : { state_id: values.state_id }),
          ...(values.password ? { password: values.password } : {}),
        };
        schema = patchUserSchema;
      } else {
        payload = {
          name: values.name,
          email: values.email,
          password: values.password,
          role: values.role,
          ...(values.role === 'admin' ? {} : { state_id: values.state_id }),
        };
        schema = createUserSchema;
      }
    } else {
      if (editing) {
        payload = {
          name: values.name,
          payam_id: values.payam_id,
          status: values.status,
          ...(values.password ? { password: values.password } : {}),
        };
        schema = patchOfficerSchema;
      } else {
        payload = {
          name: values.name,
          phone: values.phone.startsWith('+') ? values.phone : `+211${values.phone.trim()}`,
          password: values.password,
          payam_id: values.payam_id,
        };
        schema = createOfficerSchema;
      }
    }
    const result = schema.safeParse(payload);
    if (result.success) {
      setErrors({});
      return result.data as Record<string, unknown>;
    }
    const next: FieldErrors = {};
    for (const issue of result.error.issues) {
      const key = issue.path[0] as keyof Values;
      if (key && !next[key]) next[key] = issue.message;
    }
    setErrors(next);
    return null;
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    const payload = validate();
    if (!payload) return;
    setBusy(true);
    setFormError(undefined);
    try {
      if (kind === 'staff') {
        if (!LIVE_ADMIN) {
          onSavedStaff({
            id: staff?.id ?? crypto.randomUUID(),
            name: values.name,
            role: values.role as StaffUser['role'],
            state_id: values.role === 'admin' ? null : values.state_id,
            last_login_at: staff?.last_login_at ?? null,
            created_at: staff?.created_at ?? new Date().toISOString(),
          });
        } else if (editing && staff) {
          onSavedStaff(await patchStaff(staff.id, payload));
        } else {
          onSavedStaff(await createStaff(payload as never));
        }
      } else {
        if (!LIVE_ADMIN) {
          onSavedOfficer({
            id: officer?.id ?? crypto.randomUUID(),
            name: values.name,
            phone: values.phone.startsWith('+') ? values.phone : `+211${values.phone.trim()}`,
            payam_id: values.payam_id,
            state_id: officer?.state_id ?? values.payam_id.slice(0, 2),
            status: editing ? values.status : 'active',
            last_sync_at: officer?.last_sync_at ?? null,
            created_at: officer?.created_at ?? new Date().toISOString(),
          });
        } else if (editing && officer) {
          onSavedOfficer(await patchOfficer(officer.id, payload));
        } else {
          onSavedOfficer(await createOfficer(payload as never));
        }
      }
      onClose();
    } catch (err) {
      setFormError(
        err instanceof AdminApiError ? err.message : 'Could not save. Please try again.',
      );
    } finally {
      setBusy(false);
    }
  }

  const title = `${editing ? 'Edit' : 'Add'} ${kind === 'staff' ? 'staff account' : 'officer'}`;
  const isAdmin = values.role === 'admin';

  return (
    <Dialog
      open
      onClose={onClose}
      title={title}
      footer={
        <>
          <Button variant="ghost" type="button" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button variant="primary" type="submit" form="account-form" disabled={busy}>
            {editing ? 'Save changes' : 'Create account'}
          </Button>
        </>
      }
    >
      <form id="account-form" onSubmit={submit} noValidate>
        {formError ? (
          <Notice kind="error">
            <p className="small">{formError}</p>
          </Notice>
        ) : null}

        <Field label="Full name" error={errors.name}>
          {(ids) => (
            <Input
              {...ids}
              value={values.name}
              dir="auto"
              onChange={(e) => set('name', e.target.value)}
            />
          )}
        </Field>

        {kind === 'staff' ? (
          <>
            {!editing ? (
              <Field label="Email" error={errors.email} hint="Used to sign in.">
                {(ids) => (
                  <Input
                    {...ids}
                    type="email"
                    autoComplete="off"
                    value={values.email}
                    onChange={(e) => set('email', e.target.value)}
                  />
                )}
              </Field>
            ) : null}

            <Field label="Role" error={errors.role}>
              {(ids) => (
                <Select {...ids} value={values.role} onChange={(e) => set('role', e.target.value)}>
                  {USER_ROLES.map((r) => (
                    <option key={r} value={r}>
                      {ROLE_LABEL[r]}
                    </option>
                  ))}
                </Select>
              )}
            </Field>

            {!isAdmin ? (
              <Field
                label="Assigned state"
                error={errors.state_id}
                hint="A supervisor or read-only account sees only this state."
              >
                {(ids) => (
                  <Select
                    {...ids}
                    value={values.state_id}
                    onChange={(e) => set('state_id', e.target.value)}
                  >
                    <option value="">Choose a state…</option>
                    {STATE_OPTIONS.map(([id, name]) => (
                      <option key={id} value={id}>
                        {name}
                      </option>
                    ))}
                  </Select>
                )}
              </Field>
            ) : null}
          </>
        ) : (
          <>
            {!editing ? (
              <Field label="Phone number" error={errors.phone} hint="The officer signs in with it.">
                {(ids) => (
                  <PrefixedInput
                    {...ids}
                    prefix="+211"
                    inputMode="tel"
                    className="mono"
                    placeholder="9XX XXX XXX"
                    value={values.phone.replace(/^\+211/, '')}
                    onChange={(e) => set('phone', e.target.value)}
                  />
                )}
              </Field>
            ) : null}

            <Field label="Payam" error={errors.payam_id}>
              {(ids) => (
                <Select
                  {...ids}
                  value={values.payam_id}
                  onChange={(e) => set('payam_id', e.target.value)}
                >
                  <option value="">Choose a payam…</option>
                  {PAYAM_OPTIONS.map(([id, name]) => (
                    <option key={id} value={id}>
                      {name}
                    </option>
                  ))}
                </Select>
              )}
            </Field>

            {editing ? (
              <Field label="Status" error={errors.status}>
                {(ids) => (
                  <Select
                    {...ids}
                    value={values.status}
                    onChange={(e) => set('status', e.target.value as 'active' | 'inactive')}
                  >
                    <option value="active">Active</option>
                    <option value="inactive">Inactive</option>
                  </Select>
                )}
              </Field>
            ) : null}
          </>
        )}

        {/*
         * SETTING A PASSWORD, NOT SENDING A RESET.
         *
         * `PATCH` sets the credential directly; there is no reset-email route,
         * no reset link and no temporary-password flow anywhere in this system,
         * so the field says what it does. It is masked: an administrator sets
         * this at a desk that other people walk past, and `type="text"` put a
         * live credential on screen in plain sight. The value is never echoed
         * into a message, a URL or an audit row — the route writes
         * `user.password_set` with before and after both null (C-4.6).
         *
         * Absent entirely when the account is the administrator's own.
         */}
        {canSetPassword ? (
          <Field
            label={editing ? 'Set password' : 'Initial password'}
            optional={editing}
            error={errors.password}
            hint={
              editing
                ? 'Leave blank to keep the current password. At least 12 characters if you set one.'
                : 'At least 12 characters. The account holder changes it after first sign-in.'
            }
          >
            {(ids) => (
              <Input
                {...ids}
                type="password"
                autoComplete="new-password"
                value={values.password}
                onChange={(e) => set('password', e.target.value)}
              />
            )}
          </Field>
        ) : (
          <p className="small muted">
            You cannot set the password on your own account through this screen.
          </p>
        )}
      </form>
    </Dialog>
  );
}
