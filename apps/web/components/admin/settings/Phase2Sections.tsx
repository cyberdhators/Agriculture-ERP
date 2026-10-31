'use client';

import Link from 'next/link';
import { useState, type ReactNode } from 'react';

import {
  DATE_FORMATS,
  DATE_FORMAT_LABELS,
  LISTING_CATEGORIES,
  LISTING_UNITS,
  PHASE2_RANGES,
  PROFILE_CROPS,
  SERVICE_CURRENCY,
  SERVICE_TIME_ZONE,
  SETTING_SCHEMAS,
  type SettingKey,
  type SettingValues,
} from '@agri-erp/shared';

import {
  Button,
  Card,
  CardBody,
  CardHeader,
  Checkbox,
  Field,
  Input,
  Notice,
  Select,
} from '@/components/ui';

import { asFailure, saveSetting, valueFields, type CurrentSetting, type Failure } from './api';
import { SettingHistory, VersionLine } from './common';

/**
 * SETTINGS, PHASE 2 (2026-10-27): language and region, registration and
 * recovery, profile privacy defaults, marketplace and reference lists, and
 * notifications and moderation. Each is a versioned setting exactly as in
 * phase 1: a save appends a version and an audit row, earlier versions stay
 * readable, and a save against an older version is refused.
 *
 * Every field here is read by the code named in its hint. Nothing is offered
 * that nothing obeys.
 */

function issues(error: { issues: { path: PropertyKey[]; message: string }[] }) {
  const out: Record<string, string> = {};
  for (const issue of error.issues)
    out[issue.path.map(String).join('.') || 'body'] ??= issue.message;
  return out;
}

/** One phase-2 setting's form: its draft, its checks and its save. */
function SettingForm<K extends SettingKey>({
  settingKey,
  setting,
  onSaved,
  title,
  subtitle,
  children,
}: {
  settingKey: K;
  setting: CurrentSetting<K>;
  onSaved: (s: CurrentSetting) => void;
  title: string;
  subtitle: string;
  children: (
    value: SettingValues[K],
    set: (v: SettingValues[K]) => void,
    fields: Record<string, string>,
  ) => ReactNode;
}) {
  const [value, setValue] = useState<SettingValues[K]>(setting.value);
  const [fields, setFields] = useState<Record<string, string>>({});
  const [failure, setFailure] = useState<Failure | null>(null);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState<number | null>(null);

  const save = async () => {
    setSaved(null);
    setFailure(null);
    const parsed = SETTING_SCHEMAS[settingKey].safeParse(value);
    if (!parsed.success) {
      setFields(issues(parsed.error));
      return;
    }
    setFields({});
    setBusy(true);
    try {
      const fresh = await saveSetting(settingKey, setting.version, parsed.data);
      setValue(fresh.value);
      setSaved(fresh.version);
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
      <CardHeader title={title} subtitle={subtitle} />
      <CardBody>
        <VersionLine setting={setting} />
        {children(value, setValue, fields)}
        {failure && Object.keys(valueFields(failure)).length === 0 ? (
          <Notice kind="error">
            <p className="small">{failure.message}</p>
          </Notice>
        ) : null}
        {saved !== null ? <Notice kind="success">Saved as version {saved}.</Notice> : null}
        <div>
          <Button onClick={() => void save()} disabled={busy}>
            {busy ? 'Saving…' : `Save ${title.toLowerCase()}`}
          </Button>
        </div>
        <SettingHistory settingKey={settingKey} />
      </CardBody>
    </Card>
  );
}

const range = (r: readonly [number, number]) => `${r[0]} to ${r[1]}`;

/** A whole-number input that keeps the typed text until it is a number. */
function NumberField({
  label,
  hint,
  error,
  value,
  onChange,
  min,
  max,
  allowBlank = false,
}: {
  label: string;
  hint: string;
  error?: string;
  value: number | null;
  onChange: (v: number | null) => void;
  min: number;
  max: number;
  allowBlank?: boolean;
}) {
  return (
    <Field label={label} hint={hint} error={error} optional={allowBlank}>
      {(ids) => (
        <Input
          {...ids}
          type="number"
          inputMode="numeric"
          min={min}
          max={max}
          value={value === null ? '' : String(value)}
          onChange={(e) => {
            const raw = e.target.value.trim();
            if (raw === '' && allowBlank) onChange(null);
            else onChange(Number(raw));
          }}
        />
      )}
    </Field>
  );
}

// ---------------------------------------------------------------------------

export function LanguageRegionSection({
  setting,
  onSaved,
}: {
  setting: CurrentSetting<'language_region'>;
  onSaved: (s: CurrentSetting) => void;
}) {
  return (
    <SettingForm
      settingKey="language_region"
      setting={setting}
      onSaved={onSaved}
      title="Language and region"
      subtitle="The languages people may choose, and how dates are written."
    >
      {(value, set, fields) => (
        <>
          <fieldset style={{ border: 0, padding: 0, margin: 0 }}>
            <legend className="label">Languages offered</legend>
            <Checkbox
              label="English (always on: every text has an English original)"
              checked
              disabled
            />
            <Checkbox
              label="Arabic"
              checked={value.enabled_languages.includes('ar')}
              onChange={(e) =>
                set({
                  ...value,
                  enabled_languages: e.target.checked ? ['en', 'ar'] : ['en'],
                })
              }
            />
            <p className="small muted">
              Read by the farmer screens&apos; language choices. Someone who already chose Arabic
              sees English once it is switched off.
            </p>
            {fields.enabled_languages ? (
              <p className="small error">{fields.enabled_languages}</p>
            ) : null}
          </fieldset>
          <Field
            label="Date format"
            hint="Read by the portal wherever a date is shown."
            error={fields.date_format}
          >
            {(ids) => (
              <Select
                {...ids}
                value={value.date_format}
                onChange={(e) =>
                  set({ ...value, date_format: e.target.value as (typeof DATE_FORMATS)[number] })
                }
              >
                {DATE_FORMATS.map((f) => (
                  <option key={f} value={f}>
                    {DATE_FORMAT_LABELS[f]}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <dl className="small" style={{ display: 'grid', gap: 4 }}>
            <div>
              <dt className="label">Time zone (fixed)</dt>
              <dd>{SERVICE_TIME_ZONE} (UTC+2). Times are stored in UTC and shown in Juba time.</dd>
            </div>
            <div>
              <dt className="label">Currency (fixed)</dt>
              <dd>
                {SERVICE_CURRENCY}, South Sudanese pound. Prices are recorded in SSP; another
                currency would need a change to the records, not a setting.
              </dd>
            </div>
            <div>
              <dt className="label">Units</dt>
              <dd>
                Quantities use the listing units (kg, bags, crates, litres and others) and land the
                unit the farmer gives (feddan, acre or hectare). Units can be archived under
                Marketplace and reference lists.
              </dd>
            </div>
          </dl>
        </>
      )}
    </SettingForm>
  );
}

export function RegistrationRecoverySection({
  setting,
  onSaved,
}: {
  setting: CurrentSetting<'registration_recovery'>;
  onSaved: (s: CurrentSetting) => void;
}) {
  const R = PHASE2_RANGES;
  return (
    <SettingForm
      settingKey="registration_recovery"
      setting={setting}
      onSaved={onSaved}
      title="Registration and recovery"
      subtitle="Sign-up codes, session rules and age eligibility. Registration is always open."
    >
      {(value, set, fields) => (
        <>
          <NumberField
            label="Wait before another sign-up code (seconds)"
            hint={`${range(R.codeResendSeconds)}. Read by the sign-up code route.`}
            error={fields.code_resend_seconds}
            value={value.code_resend_seconds}
            min={R.codeResendSeconds[0]}
            max={R.codeResendSeconds[1]}
            onChange={(v) => set({ ...value, code_resend_seconds: v ?? 0 })}
          />
          <NumberField
            label="Inactivity before a return session (minutes)"
            hint={`${range(R.sessionInactivityMinutes)}. Read by the access log: a visit after this long without activity, while still signed in, is recorded as a return session.`}
            error={fields.session_inactivity_minutes}
            value={value.session_inactivity_minutes}
            min={R.sessionInactivityMinutes[0]}
            max={R.sessionInactivityMinutes[1]}
            onChange={(v) => set({ ...value, session_inactivity_minutes: v ?? 0 })}
          />
          <NumberField
            label="Minimum age to register as a farmer (years)"
            hint={`${range(R.minimumAgeYears)}, or blank for no minimum. Read by farmer self-registration, from the year of birth; registrations by an officer are not affected.`}
            error={fields.minimum_age_years}
            value={value.minimum_age_years}
            min={R.minimumAgeYears[0]}
            max={R.minimumAgeYears[1]}
            allowBlank
            onChange={(v) => set({ ...value, minimum_age_years: v })}
          />
          <p className="small muted">
            Sign-in methods are fixed by the sign-in service: farmers use a phone number, buyers and
            staff an email address.
          </p>
        </>
      )}
    </SettingForm>
  );
}

export function ProfilePrivacySection({
  setting,
  onSaved,
}: {
  setting: CurrentSetting<'profile_privacy'>;
  onSaved: (s: CurrentSetting) => void;
}) {
  return (
    <SettingForm
      settingKey="profile_privacy"
      setting={setting}
      onSaved={onSaved}
      title="Profile privacy"
      subtitle="What a new public profile starts with; the owner can change it."
    >
      {(value, set, fields) => (
        <>
          <Notice kind="info" title="Existing profiles are never changed">
            <p className="small">
              A new default applies only to profiles created after you save it.
            </p>
          </Notice>
          <Checkbox
            label="Show the phone number on a new profile"
            checked={value.show_phone_default}
            onChange={(e) => set({ ...value, show_phone_default: e.target.checked })}
          />
          <Checkbox
            label="Allow messages to a new profile"
            checked={value.allow_messages_default}
            onChange={(e) => set({ ...value, allow_messages_default: e.target.checked })}
          />
          {fields.show_phone_default || fields.allow_messages_default ? (
            <p className="small error">
              {fields.show_phone_default ?? fields.allow_messages_default}
            </p>
          ) : null}
          <p className="small muted">
            Discoverability: a new profile is always a draft until its owner publishes it, and
            sign-in and recovery details are never public. These are fixed.
          </p>
        </>
      )}
    </SettingForm>
  );
}

const CATEGORY_LABELS: Record<(typeof LISTING_CATEGORIES)[number], string> = {
  crop: 'Crops',
  vegetable: 'Vegetables',
  fruit: 'Fruit',
  livestock: 'Livestock',
  poultry: 'Poultry',
  dairy: 'Dairy',
  fish: 'Fish',
  processed: 'Processed goods',
  seeds_inputs: 'Seeds and inputs',
  other: 'Other',
};
const UNIT_LABELS: Record<(typeof LISTING_UNITS)[number], string> = {
  kg: 'kg',
  bag_50kg: 'Bag (50 kg)',
  bag_100kg: 'Bag (100 kg)',
  sack: 'Sack',
  crate: 'Crate',
  bunch: 'Bunch',
  piece: 'Piece',
  head: 'Head',
  litre: 'Litre',
  tin: 'Tin',
};

function ArchiveList<T extends string>({
  legend,
  values,
  labels,
  archived,
  onChange,
  error,
}: {
  legend: string;
  values: readonly T[];
  labels: (v: T) => string;
  archived: readonly T[];
  onChange: (next: T[]) => void;
  error?: string;
}) {
  return (
    <fieldset style={{ border: 0, padding: 0, margin: 0 }}>
      <legend className="label">{legend}</legend>
      <div
        style={{
          display: 'grid',
          gap: 4,
          gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))',
        }}
      >
        {values.map((v) => (
          <Checkbox
            key={v}
            label={`${labels(v)}${archived.includes(v) ? ' (archived)' : ''}`}
            checked={!archived.includes(v)}
            onChange={(e) =>
              onChange(e.target.checked ? archived.filter((x) => x !== v) : [...archived, v])
            }
          />
        ))}
      </div>
      {error ? <p className="small error">{error}</p> : null}
    </fieldset>
  );
}

export function ReferenceListsSection({
  setting,
  onSaved,
}: {
  setting: CurrentSetting<'reference_lists'>;
  onSaved: (s: CurrentSetting) => void;
}) {
  const R = PHASE2_RANGES;
  return (
    <SettingForm
      settingKey="reference_lists"
      setting={setting}
      onSaved={onSaved}
      title="Marketplace and reference lists"
      subtitle="How long a post stays up, and what new entries may choose."
    >
      {(value, set, fields) => (
        <>
          <NumberField
            label="Listing validity (days)"
            hint={`${range(R.listingValidityDays)}. Read when a listing or a service is posted or renewed without an end date.`}
            error={fields.listing_validity_days}
            value={value.listing_validity_days}
            min={R.listingValidityDays[0]}
            max={R.listingValidityDays[1]}
            onChange={(v) => set({ ...value, listing_validity_days: v ?? 0 })}
          />
          <NumberField
            label="Reminder before a listing ends (days)"
            hint={`${range(R.listingReminderDays)}. Read by the owner's listing screens, which mark a post ending within this many days so it can be renewed.`}
            error={fields.listing_reminder_days}
            value={value.listing_reminder_days}
            min={R.listingReminderDays[0]}
            max={R.listingReminderDays[1]}
            onChange={(v) => set({ ...value, listing_reminder_days: v ?? 0 })}
          />
          <Notice kind="info" title="Archiving keeps every record">
            <p className="small">
              An unticked value is no longer offered for new posts or registrations. Existing
              records keep it. Tick it again to restore it.
            </p>
          </Notice>
          <ArchiveList
            legend="Categories offered"
            values={LISTING_CATEGORIES}
            labels={(v) => CATEGORY_LABELS[v]}
            archived={value.archived_categories}
            onChange={(next) => set({ ...value, archived_categories: next })}
            error={fields.archived_categories}
          />
          <ArchiveList
            legend="Units offered"
            values={LISTING_UNITS}
            labels={(v) => UNIT_LABELS[v]}
            archived={value.archived_units}
            onChange={(next) => set({ ...value, archived_units: next })}
            error={fields.archived_units}
          />
          <ArchiveList
            legend="Crops on the farmer registration form (commodities)"
            values={PROFILE_CROPS}
            labels={(v) => v.replace(/_/g, ' ')}
            archived={value.archived_crops}
            onChange={(next) => set({ ...value, archived_crops: next })}
            error={fields.archived_crops}
          />
          <p className="small muted">
            Locations (states, counties, payams) come from the official location list and are
            changed by a location update, not here.
          </p>
        </>
      )}
    </SettingForm>
  );
}

export function NotificationsModerationSection({
  setting,
  onSaved,
}: {
  setting: CurrentSetting<'notifications_moderation'>;
  onSaved: (s: CurrentSetting) => void;
}) {
  const R = PHASE2_RANGES;
  return (
    <SettingForm
      settingKey="notifications_moderation"
      setting={setting}
      onSaved={onSaved}
      title="Notifications and moderation"
      subtitle="SMS cost for announcement previews, the suspension review period and the appeal window."
    >
      {(value, set, fields) => (
        <>
          <p className="small">
            Message templates, announcements and their delivery records are in{' '}
            <Link href="/communications">Communications</Link>. People choose their own channels in
            their notification settings; essential and security messages cannot be switched off.
          </p>
          <Field
            label="Cost of one SMS part (US$)"
            optional
            hint="Read by the announcement preview to estimate what a send will cost. Leave blank for no estimate. Bird's invoice is the authority."
            error={fields.sms_cost_per_segment_usd}
          >
            {(ids) => (
              <Input
                {...ids}
                type="number"
                inputMode="decimal"
                step="0.001"
                min={0}
                max={1}
                value={
                  value.sms_cost_per_segment_usd === null
                    ? ''
                    : String(value.sms_cost_per_segment_usd)
                }
                onChange={(e) =>
                  set({
                    ...value,
                    sms_cost_per_segment_usd:
                      e.target.value.trim() === '' ? null : Number(e.target.value),
                  })
                }
              />
            )}
          </Field>
          <NumberField
            label="Suspension review period (days)"
            hint={`${range(R.suspensionReviewDays)}. Shown in the suspend dialog as when a suspension should be reviewed. A suspension does not end by itself: staff restore the account.`}
            error={fields.suspension_review_days}
            value={value.suspension_review_days}
            min={R.suspensionReviewDays[0]}
            max={R.suspensionReviewDays[1]}
            onChange={(v) => set({ ...value, suspension_review_days: v ?? 0 })}
          />
          <NumberField
            label="Appeal window (days)"
            hint={`${range(R.appealWindowDays)}. Shown on the help page: how long after a decision an appeal is accepted.`}
            error={fields.appeal_window_days}
            value={value.appeal_window_days}
            min={R.appealWindowDays[0]}
            max={R.appealWindowDays[1]}
            onChange={(v) => set({ ...value, appeal_window_days: v ?? 0 })}
          />
        </>
      )}
    </SettingForm>
  );
}
