'use client';

import { useState } from 'react';

import {
  SETTINGS_LIMITS,
  identitySettingSchema,
  supportSettingSchema,
  type HelpLink,
  type IdentitySetting,
  type SupportSetting,
} from '@agri-erp/shared';

import {
  Button,
  Card,
  CardBody,
  CardHeader,
  Field,
  Input,
  Notice,
  Textarea,
} from '@/components/ui';

import { asFailure, saveSetting, valueFields, type CurrentSetting, type Failure } from './api';
import { SettingHistory, VersionLine } from './common';

/** Zod issues as { field: reason }, first reason per field: what the server would answer. */
function issues(error: { issues: { path: PropertyKey[]; message: string }[] }) {
  const out: Record<string, string> = {};
  for (const issue of error.issues) {
    const key = issue.path.map(String).join('.') || 'body';
    out[key] ??= issue.message;
  }
  return out;
}

/**
 * IDENTITY AND HELP (settings phase 1): the approved service name, the About
 * text, the support contacts and the help links. The public /help page and
 * the site footer read the contacts and links; nothing unset is shown there.
 */
export function IdentitySection({
  identity,
  support,
  onSaved,
}: {
  identity: CurrentSetting<'identity'>;
  support: CurrentSetting<'support'>;
  onSaved: (setting: CurrentSetting) => void;
}) {
  return (
    <div style={{ display: 'grid', gap: 'var(--s-4)' }}>
      <IdentityForm setting={identity} onSaved={onSaved} />
      <SupportForm setting={support} onSaved={onSaved} />
    </div>
  );
}

function IdentityForm({
  setting,
  onSaved,
}: {
  setting: CurrentSetting<'identity'>;
  onSaved: (setting: CurrentSetting) => void;
}) {
  const [value, setValue] = useState<IdentitySetting>(setting.value);
  const [fields, setFields] = useState<Record<string, string>>({});
  const [failure, setFailure] = useState<Failure | null>(null);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);

  const save = async () => {
    setSaved(false);
    setFailure(null);
    const parsed = identitySettingSchema.safeParse(value);
    if (!parsed.success) {
      setFields(issues(parsed.error));
      return;
    }
    setFields({});
    setBusy(true);
    try {
      const fresh = await saveSetting('identity', setting.version, parsed.data);
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
        title="Identity"
        subtitle="The approved name of the service and the About text shown on the help page."
      />
      <CardBody>
        <VersionLine setting={setting} />
        <Field label="Service name" error={fields.service_name}>
          {(ids) => (
            <Input
              {...ids}
              maxLength={SETTINGS_LIMITS.serviceNameMax}
              value={value.service_name}
              onChange={(e) => setValue({ ...value, service_name: e.target.value })}
            />
          )}
        </Field>
        <Field
          label="About"
          optional
          hint={`Up to ${SETTINGS_LIMITS.aboutMax} characters. Shown on the help page when set.`}
          error={fields.about}
        >
          {(ids) => (
            <Textarea
              {...ids}
              rows={5}
              dir="auto"
              maxLength={SETTINGS_LIMITS.aboutMax}
              value={value.about}
              onChange={(e) => setValue({ ...value, about: e.target.value })}
            />
          )}
        </Field>
        {failure && Object.keys(valueFields(failure)).length === 0 ? (
          <Notice kind="error">
            <p className="small">{failure.message}</p>
          </Notice>
        ) : null}
        {saved ? <Notice kind="success">Saved as version {setting.version}.</Notice> : null}
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <Button onClick={() => void save()} disabled={busy}>
            {busy ? 'Saving…' : 'Save identity'}
          </Button>
        </div>
        <SettingHistory settingKey="identity" />
      </CardBody>
    </Card>
  );
}

/** The form's own shape: every contact as text, blank meaning "not published". */
interface SupportDraft {
  phone: string;
  email: string;
  whatsapp: string;
  office_hours: string;
  help_links: HelpLink[];
}

const toDraft = (v: SupportSetting): SupportDraft => ({
  phone: v.phone ?? '',
  email: v.email ?? '',
  whatsapp: v.whatsapp ?? '',
  office_hours: v.office_hours ?? '',
  help_links: v.help_links,
});

function SupportForm({
  setting,
  onSaved,
}: {
  setting: CurrentSetting<'support'>;
  onSaved: (setting: CurrentSetting) => void;
}) {
  const [draft, setDraft] = useState<SupportDraft>(toDraft(setting.value));
  const [fields, setFields] = useState<Record<string, string>>({});
  const [failure, setFailure] = useState<Failure | null>(null);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);

  const setLink = (index: number, patch: Partial<HelpLink>) =>
    setDraft({
      ...draft,
      help_links: draft.help_links.map((l, i) => (i === index ? { ...l, ...patch } : l)),
    });

  const save = async () => {
    setSaved(false);
    setFailure(null);
    const parsed = supportSettingSchema.safeParse(draft);
    if (!parsed.success) {
      setFields(issues(parsed.error));
      return;
    }
    setFields({});
    setBusy(true);
    try {
      const fresh = await saveSetting('support', setting.version, parsed.data);
      setDraft(toDraft(fresh.value));
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
        title="Support contacts and help links"
        subtitle="Shown on the public help page and in the site footer. Leave a contact blank to not publish it."
      />
      <CardBody>
        <VersionLine setting={setting} />
        <Field label="Phone" optional error={fields.phone}>
          {(ids) => (
            <Input
              {...ids}
              inputMode="tel"
              dir="ltr"
              placeholder="+211 9XX XXX XXX"
              value={draft.phone}
              onChange={(e) => setDraft({ ...draft, phone: e.target.value })}
            />
          )}
        </Field>
        <Field label="WhatsApp" optional error={fields.whatsapp}>
          {(ids) => (
            <Input
              {...ids}
              inputMode="tel"
              dir="ltr"
              placeholder="+211 9XX XXX XXX"
              value={draft.whatsapp}
              onChange={(e) => setDraft({ ...draft, whatsapp: e.target.value })}
            />
          )}
        </Field>
        <Field label="Email" optional error={fields.email}>
          {(ids) => (
            <Input
              {...ids}
              type="email"
              dir="ltr"
              value={draft.email}
              onChange={(e) => setDraft({ ...draft, email: e.target.value })}
            />
          )}
        </Field>
        <Field
          label="Opening hours"
          optional
          hint="For example: Monday to Friday, 8:00 to 17:00 (Juba time)."
          error={fields.office_hours}
        >
          {(ids) => (
            <Input
              {...ids}
              dir="auto"
              maxLength={SETTINGS_LIMITS.officeHoursMax}
              value={draft.office_hours}
              onChange={(e) => setDraft({ ...draft, office_hours: e.target.value })}
            />
          )}
        </Field>

        <p className="label" style={{ marginTop: 'var(--s-3)' }}>
          Help links
        </p>
        {fields.help_links ? (
          <Notice kind="error">
            <p className="small">{fields.help_links}</p>
          </Notice>
        ) : null}
        {draft.help_links.length === 0 ? <p className="small muted">No help links.</p> : null}
        {draft.help_links.map((link, i) => (
          <div
            key={i}
            style={{
              display: 'grid',
              gap: 8,
              gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 2fr) auto',
              alignItems: 'end',
            }}
          >
            <Field label="Label" error={fields[`help_links.${i}.label`]}>
              {(ids) => (
                <Input
                  {...ids}
                  dir="auto"
                  value={link.label}
                  onChange={(e) => setLink(i, { label: e.target.value })}
                />
              )}
            </Field>
            <Field label="Address (https://)" error={fields[`help_links.${i}.url`]}>
              {(ids) => (
                <Input
                  {...ids}
                  dir="ltr"
                  type="url"
                  value={link.url}
                  onChange={(e) => setLink(i, { url: e.target.value })}
                />
              )}
            </Field>
            <Button
              size="small"
              variant="ghost"
              onClick={() =>
                setDraft({ ...draft, help_links: draft.help_links.filter((_, j) => j !== i) })
              }
            >
              Remove
            </Button>
          </div>
        ))}
        {draft.help_links.length < SETTINGS_LIMITS.helpLinksMax ? (
          <div>
            <Button
              size="small"
              variant="secondary"
              onClick={() =>
                setDraft({
                  ...draft,
                  help_links: [...draft.help_links, { label: '', url: 'https://' }],
                })
              }
            >
              Add a help link
            </Button>
          </div>
        ) : null}

        {failure && Object.keys(valueFields(failure)).length === 0 ? (
          <Notice kind="error">
            <p className="small">{failure.message}</p>
          </Notice>
        ) : null}
        {saved ? <Notice kind="success">Saved as version {setting.version}.</Notice> : null}
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <Button onClick={() => void save()} disabled={busy}>
            {busy ? 'Saving…' : 'Save contacts and links'}
          </Button>
        </div>
        <SettingHistory settingKey="support" />
      </CardBody>
    </Card>
  );
}
