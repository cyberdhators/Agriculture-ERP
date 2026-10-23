'use client';

import { useEffect, useState } from 'react';

import {
  SETTINGS_LIMITS,
  maintenanceSettingSchema,
  type MaintenanceSetting,
} from '@agri-erp/shared';

import {
  Button,
  Card,
  CardBody,
  CardHeader,
  Checkbox,
  Field,
  Notice,
  Stamp,
  Textarea,
} from '@/components/ui';

import {
  asFailure,
  call,
  saveSetting,
  valueFields,
  type CurrentSetting,
  type Failure,
} from './api';
import { SettingHistory, VersionLine } from './common';

interface Status {
  integrations: {
    name: string;
    purpose: string;
    configured: boolean;
    variables: { name: string; present: boolean }[];
  }[];
  staff_mfa: { tracked: true; staff: number; with_mfa: number } | { tracked: false };
}

/**
 * SECURITY AND OPERATIONS (settings phase 1). Read-only status -- which
 * integrations are configured (by variable NAME; never a value), staff
 * multi-factor sign-in, backup and restoration -- and the one thing that is
 * edited here: the maintenance notice.
 */
export function SecuritySection({
  maintenance,
  onSaved,
}: {
  maintenance: CurrentSetting<'maintenance'>;
  onSaved: (setting: CurrentSetting) => void;
}) {
  const [status, setStatus] = useState<Status | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    call<Status>('/api/admin/settings/status')
      .then(setStatus)
      .catch((e: unknown) => setError(asFailure(e).message));
  }, []);

  return (
    <div style={{ display: 'grid', gap: 'var(--s-4)' }}>
      <MaintenanceForm setting={maintenance} onSaved={onSaved} />

      <Card>
        <CardHeader
          title="Integrations"
          subtitle="Whether each service's settings are present on this deployment. Values are never shown here, or anywhere."
        />
        <CardBody>
          {error ? (
            <Notice kind="error">
              <p className="small">{error}</p>
            </Notice>
          ) : status === null ? (
            <p className="muted">Loading…</p>
          ) : (
            <table className="small" style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr>
                  <th style={{ textAlign: 'start' }}>Service</th>
                  <th style={{ textAlign: 'start' }}>Status</th>
                  <th style={{ textAlign: 'start' }}>Variables</th>
                </tr>
              </thead>
              <tbody>
                {status.integrations.map((i) => (
                  <tr key={i.name} style={{ borderTop: '1px solid var(--line)' }}>
                    <td>
                      <strong>{i.name}</strong>
                      <span className="muted" style={{ display: 'block' }}>
                        {i.purpose}
                      </span>
                    </td>
                    <td>
                      {i.variables.length === 0 ? (
                        <Stamp kind="neutral">Not in use</Stamp>
                      ) : i.configured ? (
                        <Stamp kind="verified">Configured</Stamp>
                      ) : (
                        <Stamp kind="rejected">Incomplete</Stamp>
                      )}
                    </td>
                    <td>
                      {i.variables.length === 0
                        ? 'No variable is read yet.'
                        : i.variables.map((v) => (
                            <span key={v.name} className="mono" style={{ display: 'block' }}>
                              {v.name}: {v.present ? 'set' : 'missing'}
                            </span>
                          ))}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </CardBody>
      </Card>

      <Card>
        <CardHeader
          title="Staff sign-in"
          subtitle="Multi-factor authentication for staff accounts."
        />
        <CardBody>
          {status === null ? (
            <p className="muted">Loading…</p>
          ) : status.staff_mfa.tracked ? (
            <p className="small">
              {status.staff_mfa.with_mfa} of {status.staff_mfa.staff} staff accounts have a verified
              authenticator app.
            </p>
          ) : (
            <p className="small">
              Not tracked: the sign-in service&apos;s records cannot be read here.
            </p>
          )}
          <p className="small muted">
            Appointing or removing a Super Admin requires the person&apos;s own password again, and
            their authenticator code if they have one. Enrolling an authenticator app is not built
            yet, so ordinary sign-in is by password.
          </p>
        </CardBody>
      </Card>

      <Card>
        <CardHeader
          title="Backup and restoration"
          subtitle="From the restore runbook (docs/RUNBOOK-restore.md). Static text; not a live reading."
        />
        <CardBody>
          <ul
            className="small"
            style={{ margin: 0, paddingInlineStart: 18, display: 'grid', gap: 6 }}
          >
            <li>
              Backups are taken by Supabase on the Pro plan (daily; up to 24 hours of work can be
              lost) or with point-in-time recovery (about 2 minutes). On the free tier there is no
              backup at all.
            </li>
            <li>
              Photos and recordings in file storage are not part of a database backup; the runbook
              says how the records pointing at them are corrected after a restore.
            </li>
            <li>
              Before every backup and planned restore, a manifest of counts is taken; after a
              restore it is compared, and the restore passes only when every difference is
              explained.
            </li>
            <li>
              Last backup and last restore drill: not recorded in the application. Check the
              Supabase dashboard (Database, Backups) and the drill log kept with the runbook.
            </li>
            <li>
              Responsible: a CORWADO administrator, following the runbook. No named owner is
              recorded yet.
            </li>
          </ul>
        </CardBody>
      </Card>
    </div>
  );
}

function MaintenanceForm({
  setting,
  onSaved,
}: {
  setting: CurrentSetting<'maintenance'>;
  onSaved: (setting: CurrentSetting) => void;
}) {
  const [value, setValue] = useState<MaintenanceSetting>(setting.value);
  const [fields, setFields] = useState<Record<string, string>>({});
  const [failure, setFailure] = useState<Failure | null>(null);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);

  const save = async () => {
    setSaved(false);
    setFailure(null);
    const parsed = maintenanceSettingSchema.safeParse(value);
    if (!parsed.success) {
      const next: Record<string, string> = {};
      for (const issue of parsed.error.issues)
        next[String(issue.path[0] ?? 'body')] ??= issue.message;
      setFields(next);
      return;
    }
    setFields({});
    setBusy(true);
    try {
      const fresh = await saveSetting('maintenance', setting.version, parsed.data);
      setValue(fresh.value);
      setSaved(true);
      onSaved(fresh);
    } catch (e) {
      const f = asFailure(e);
      setFailure(f);
      setFields(valueFields(f));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card>
      <CardHeader
        title="Maintenance notice"
        subtitle="A banner at the top of every page, public and staff, while it is on. It informs; it does not stop anything working."
        actions={
          setting.value.enabled ? (
            <Stamp kind="escalated">On</Stamp>
          ) : (
            <Stamp kind="neutral">Off</Stamp>
          )
        }
      />
      <CardBody>
        <VersionLine setting={setting} />
        <Field
          label="Notice text"
          hint={`${SETTINGS_LIMITS.bannerMin} to ${SETTINGS_LIMITS.bannerMax} characters to switch it on.`}
          error={fields.message}
        >
          {(ids) => (
            <Textarea
              {...ids}
              rows={2}
              dir="auto"
              maxLength={SETTINGS_LIMITS.bannerMax}
              value={value.message}
              onChange={(e) => setValue({ ...value, message: e.target.value })}
            />
          )}
        </Field>
        <Checkbox
          label="Show the notice on every page"
          checked={value.enabled}
          onChange={(e) => setValue({ ...value, enabled: e.target.checked })}
        />
        {failure && Object.keys(valueFields(failure)).length === 0 ? (
          <Notice kind="error">
            <p className="small">{failure.message}</p>
          </Notice>
        ) : null}
        {saved ? (
          <Notice kind="success">Saved. Pages pick the change up within about a minute.</Notice>
        ) : null}
        <div>
          <Button onClick={() => void save()} disabled={busy}>
            {busy ? 'Saving…' : 'Save notice'}
          </Button>
        </div>
        <SettingHistory settingKey="maintenance" />
      </CardBody>
    </Card>
  );
}
