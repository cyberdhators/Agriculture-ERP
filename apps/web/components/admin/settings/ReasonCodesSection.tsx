'use client';

import { useState } from 'react';

import {
  REASON_TARGETS,
  SETTINGS_LIMITS,
  reasonCodesSettingSchema,
  type ReasonCodeEntry,
  type ReasonTarget,
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
  Stamp,
} from '@/components/ui';

import { asFailure, saveSetting, valueFields, type CurrentSetting, type Failure } from './api';
import { SettingHistory, VersionLine } from './common';

const TARGET_LABEL: Record<ReasonTarget, string> = {
  listing: 'Listing',
  account: 'Account',
  profile: 'Profile',
  report: 'Report',
};

/** A suggested code from a label: "Fake photos" -> "fake_photos". */
const codeFrom = (label: string) =>
  label
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .replace(/^[^a-z]+/, '')
    .slice(0, 40);

/**
 * MODERATION REASON CODES (settings phase 1). The list the suspend and report
 * dialogs offer, each code pre-filling the written reason. A code that has
 * been saved is never removed -- past decisions may name it -- so it is
 * ARCHIVED (no longer offered) and can be restored; its code never changes.
 */
export function ReasonCodesSection({
  setting,
  onSaved,
}: {
  setting: CurrentSetting<'reason_codes'>;
  onSaved: (setting: CurrentSetting) => void;
}) {
  const [codes, setCodes] = useState<ReasonCodeEntry[]>(setting.value.codes);
  const [fields, setFields] = useState<Record<string, string>>({});
  const [failure, setFailure] = useState<Failure | null>(null);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const savedCodes = new Set(setting.value.codes.map((c) => c.code));

  const set = (index: number, patch: Partial<ReasonCodeEntry>) =>
    setCodes(codes.map((c, i) => (i === index ? { ...c, ...patch } : c)));

  const toggleTarget = (index: number, target: ReasonTarget, on: boolean) => {
    const current = codes[index]?.applies_to ?? [];
    set(index, {
      applies_to: on
        ? REASON_TARGETS.filter((t) => t === target || current.includes(t))
        : current.filter((t) => t !== target),
    });
  };

  const save = async () => {
    setSaved(false);
    setFailure(null);
    const parsed = reasonCodesSettingSchema.safeParse({ codes });
    if (!parsed.success) {
      const next: Record<string, string> = {};
      for (const issue of parsed.error.issues) {
        next[issue.path.map(String).join('.') || 'codes'] ??= issue.message;
      }
      setFields(next);
      return;
    }
    setFields({});
    setBusy(true);
    try {
      const fresh = await saveSetting('reason_codes', setting.version, parsed.data);
      setCodes(fresh.value.codes);
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
        title="Moderation reason codes"
        subtitle="Offered in the suspend and report dialogs; a written reason is still required."
      />
      <CardBody>
        <VersionLine setting={setting} />
        {fields.codes ? (
          <Notice kind="error">
            <p className="small">{fields.codes}</p>
          </Notice>
        ) : null}
        <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'grid', gap: 12 }}>
          {codes.map((c, i) => {
            const isSaved = savedCodes.has(c.code);
            return (
              <li
                key={i}
                style={{
                  border: '1px solid var(--line)',
                  borderRadius: 8,
                  padding: 12,
                  display: 'grid',
                  gap: 8,
                  opacity: c.active ? 1 : 0.7,
                }}
              >
                <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                  {c.active ? (
                    <Stamp kind="verified">Active</Stamp>
                  ) : (
                    <Stamp kind="neutral">Archived</Stamp>
                  )}
                  {isSaved ? <span className="small mono">{c.code}</span> : null}
                </div>
                <Field label="Label" error={fields[`codes.${i}.label`]}>
                  {(ids) => (
                    <Input
                      {...ids}
                      dir="auto"
                      maxLength={SETTINGS_LIMITS.reasonLabelMax}
                      value={c.label}
                      onChange={(e) =>
                        set(
                          i,
                          isSaved
                            ? { label: e.target.value }
                            : { label: e.target.value, code: codeFrom(e.target.value) },
                        )
                      }
                    />
                  )}
                </Field>
                {!isSaved ? (
                  <Field
                    label="Code"
                    hint="Lower-case letters, digits and underscores. It cannot be changed once saved."
                    error={fields[`codes.${i}.code`]}
                  >
                    {(ids) => (
                      <Input
                        {...ids}
                        dir="ltr"
                        className="mono"
                        maxLength={40}
                        value={c.code}
                        onChange={(e) => set(i, { code: e.target.value })}
                      />
                    )}
                  </Field>
                ) : null}
                <fieldset style={{ border: 0, padding: 0, margin: 0 }}>
                  <legend className="small">Offered for</legend>
                  <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
                    {REASON_TARGETS.map((t) => (
                      <Checkbox
                        key={t}
                        label={TARGET_LABEL[t]}
                        checked={c.applies_to.includes(t)}
                        onChange={(e) => toggleTarget(i, t, e.target.checked)}
                      />
                    ))}
                  </div>
                  {fields[`codes.${i}.applies_to`] ? (
                    <p className="small" role="alert">
                      {fields[`codes.${i}.applies_to`]}
                    </p>
                  ) : null}
                </fieldset>
                <div>
                  {isSaved ? (
                    <Button
                      size="small"
                      variant="secondary"
                      onClick={() => set(i, { active: !c.active })}
                    >
                      {c.active ? 'Archive' : 'Restore'}
                    </Button>
                  ) : (
                    <Button
                      size="small"
                      variant="ghost"
                      onClick={() => setCodes(codes.filter((_, j) => j !== i))}
                    >
                      Remove unsaved code
                    </Button>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
        {codes.length < SETTINGS_LIMITS.reasonCodesMax ? (
          <div>
            <Button
              size="small"
              variant="secondary"
              onClick={() =>
                setCodes([
                  ...codes,
                  { code: '', label: '', applies_to: [...REASON_TARGETS], active: true },
                ])
              }
            >
              Add a reason code
            </Button>
          </div>
        ) : null}
        {failure && Object.keys(valueFields(failure)).length === 0 ? (
          <Notice kind="error">
            <p className="small">{failure.message}</p>
          </Notice>
        ) : null}
        {saved ? <Notice kind="success">Saved as version {setting.version}.</Notice> : null}
        <div>
          <Button onClick={() => void save()} disabled={busy}>
            {busy ? 'Saving…' : 'Save reason codes'}
          </Button>
        </div>
        <SettingHistory settingKey="reason_codes" />
      </CardBody>
    </Card>
  );
}
