'use client';

import { useEffect, useMemo, useState } from 'react';

import {
  ACTIVITIES,
  ANNOUNCEMENT_CHANNELS,
  ANNOUNCEMENT_LIMITS,
  ANNOUNCEMENT_SCOPES,
  ANNOUNCEMENT_SCOPE_LABELS,
  announcementDraftSchema,
  smsEstimate,
  type Activity,
  type AnnouncementCategory,
  type AnnouncementChannel,
  type AnnouncementScopeKind,
  type MessageTemplate,
  type StaffAnnouncement,
} from '@agri-erp/shared';

import { Button, Card, CardBody, CardHeader, Checkbox, Field, Input, Notice, Select, Textarea } from '@/components/ui';
import {
  asFailure,
  createAnnouncement,
  listTemplates,
  updateAnnouncement,
  type Failure,
} from '@/lib/communications/announcements';
import { useLocationNames } from '@/lib/portal/locations';

export const CHANNEL_LABELS: Record<AnnouncementChannel, string> = {
  in_app: 'In the app',
  sms: 'SMS',
  email: 'Email',
};

export const ACTIVITY_LABELS: Record<Activity, string> = {
  farmer: 'Farmers',
  trader: 'Traders',
  processor: 'Processors',
  input_supplier: 'Input suppliers',
  transport: 'Transport',
  other_services: 'Other services',
  knowledge_provider: 'Knowledge providers',
  financial_services: 'Financial services',
  buyer: 'Buyers',
};

interface Draft {
  title: string;
  body: string;
  sms_body: string;
  category: AnnouncementCategory;
  channels: AnnouncementChannel[];
  scope_kind: AnnouncementScopeKind;
  state_id: string;
  activity: Activity | '';
  template_id: string | null;
}

const fromAnnouncement = (a: StaffAnnouncement | null): Draft => ({
  title: a?.title ?? '',
  body: a?.body ?? '',
  sms_body: a?.sms_body ?? '',
  category: a?.category ?? 'announcement',
  channels: a?.channels ?? ['in_app'],
  scope_kind: a?.scope.kind ?? 'all',
  state_id: a?.scope.state_id ?? '',
  activity: (a?.scope.activity as Activity | null) ?? '',
  template_id: a?.template_id ?? null,
});

const toBody = (d: Draft) => ({
  title: d.title,
  body: d.body,
  sms_body: d.channels.includes('sms') ? d.sms_body : null,
  category: d.category,
  channels: d.channels,
  scope: {
    kind: d.scope_kind,
    state_id: d.scope_kind === 'state' ? d.state_id || null : null,
    activity: d.scope_kind === 'activity' ? d.activity || null : null,
  },
  template_id: d.template_id,
});

function issues(error: { issues: { path: PropertyKey[]; message: string }[] }) {
  const out: Record<string, string> = {};
  for (const issue of error.issues) {
    const key = issue.path.map(String).join('.') || 'body';
    out[key] ??= issue.message;
  }
  return out;
}

/**
 * Compose an official announcement, or edit a draft. Saving keeps it a
 * DRAFT; nothing is sent from here. The detail page previews it -- the text
 * as received, the count, each channel's split after preferences -- and
 * sends it only after a confirmation.
 *
 * Placeholders: {name} (the recipient's first name) and {service_name}.
 */
export function AnnouncementComposer({
  announcement,
  onSaved,
  onCancel,
}: {
  announcement: StaffAnnouncement | null;
  onSaved: (a: StaffAnnouncement) => void;
  onCancel?: () => void;
}) {
  const [draft, setDraft] = useState<Draft>(() => fromAnnouncement(announcement));
  const [fields, setFields] = useState<Record<string, string>>({});
  const [failure, setFailure] = useState<Failure | null>(null);
  const [busy, setBusy] = useState(false);
  const [templates, setTemplates] = useState<MessageTemplate[]>([]);
  const locations = useLocationNames(true);

  useEffect(() => {
    let live = true;
    listTemplates()
      .then((t) => {
        if (live) setTemplates(t.filter((x) => x.status === 'active'));
      })
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, []);

  const sms = useMemo(
    () => (draft.sms_body ? smsEstimate(draft.sms_body, 'AgriOne South Sudan') : null),
    [draft.sms_body],
  );

  const scopeFixedChannel =
    draft.scope_kind === 'staff' ? 'email' : draft.scope_kind === 'officers' ? 'sms' : null;

  const setScope = (kind: AnnouncementScopeKind) => {
    const fixed = kind === 'staff' ? 'email' : kind === 'officers' ? 'sms' : null;
    setDraft({
      ...draft,
      scope_kind: kind,
      channels: fixed ? [fixed] : draft.channels.length ? draft.channels : ['in_app'],
    });
  };

  const toggle = (c: AnnouncementChannel, on: boolean) =>
    setDraft({
      ...draft,
      channels: on ? [...new Set([...draft.channels, c])] : draft.channels.filter((x) => x !== c),
    });

  const applyTemplate = (id: string) => {
    const t = templates.find((x) => x.id === id);
    if (!t) return;
    if (t.channel === 'sms') {
      setDraft({
        ...draft,
        sms_body: t.body,
        channels: [...new Set([...draft.channels, 'sms' as const])],
        template_id: t.id,
      });
    } else {
      setDraft({ ...draft, title: t.title ?? draft.title, body: t.body, template_id: t.id });
    }
  };

  const save = async () => {
    setFailure(null);
    const parsed = announcementDraftSchema.safeParse(toBody(draft));
    if (!parsed.success) {
      setFields(issues(parsed.error));
      return;
    }
    setFields({});
    setBusy(true);
    try {
      const saved = announcement
        ? await updateAnnouncement(announcement.id, parsed.data)
        : await createAnnouncement(parsed.data);
      onSaved(saved);
    } catch (e) {
      const f = asFailure(e);
      setFailure(f);
      setFields(f.fields);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card>
      <CardHeader
        title={announcement ? 'Edit draft announcement' : 'New announcement'}
        subtitle="Saved as a draft. Preview it on the next page, then send. Use {name} for the recipient's first name and {service_name} for the service name."
      />
      <CardBody>
        {templates.length > 0 ? (
          <Field label="Start from a template" optional>
            {(ids) => (
              <Select {...ids} value="" onChange={(e) => applyTemplate(e.target.value)}>
                <option value="">Choose a template…</option>
                {templates.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name} ({CHANNEL_LABELS[t.channel]})
                  </option>
                ))}
              </Select>
            )}
          </Field>
        ) : null}

        <Field label="Who receives it" error={fields['scope.kind'] ?? fields.scope}>
          {(ids) => (
            <Select
              {...ids}
              value={draft.scope_kind}
              onChange={(e) => setScope(e.target.value as AnnouncementScopeKind)}
            >
              {ANNOUNCEMENT_SCOPES.map((s) => (
                <option key={s} value={s}>
                  {ANNOUNCEMENT_SCOPE_LABELS[s]}
                </option>
              ))}
            </Select>
          )}
        </Field>
        {draft.scope_kind === 'state' ? (
          <Field label="State" error={fields['scope.state_id']}>
            {(ids) => (
              <Select
                {...ids}
                value={draft.state_id}
                onChange={(e) => setDraft({ ...draft, state_id: e.target.value })}
              >
                <option value="">Choose a state…</option>
                {locations.states.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </Select>
            )}
          </Field>
        ) : null}
        {draft.scope_kind === 'activity' ? (
          <Field
            label="Activity"
            hint="Accounts that chose this activity in their profile. Farmers and buyers include every farmer and buyer account."
            error={fields['scope.activity']}
          >
            {(ids) => (
              <Select
                {...ids}
                value={draft.activity}
                onChange={(e) => setDraft({ ...draft, activity: e.target.value as Activity })}
              >
                <option value="">Choose an activity…</option>
                {ACTIVITIES.map((a) => (
                  <option key={a} value={a}>
                    {ACTIVITY_LABELS[a]}
                  </option>
                ))}
              </Select>
            )}
          </Field>
        ) : null}

        <fieldset style={{ border: 0, padding: 0, margin: 0 }}>
          <legend className="label">Channels</legend>
          {ANNOUNCEMENT_CHANNELS.map((c) => (
            <Checkbox
              key={c}
              label={CHANNEL_LABELS[c]}
              checked={draft.channels.includes(c)}
              disabled={scopeFixedChannel !== null}
              onChange={(e) => toggle(c, e.target.checked)}
            />
          ))}
          {fields.channels ? <p className="small error">{fields.channels}</p> : null}
          <p className="small muted">
            Each person&apos;s notification settings are respected unless the announcement is
            essential. Private conversations are never used to reach anyone.
          </p>
        </fieldset>

        <Field
          label="Kind"
          hint="Essential is for account, security and service-continuity messages: it is sent whatever people have switched off. Use it sparingly."
          error={fields.category}
        >
          {(ids) => (
            <Select
              {...ids}
              value={draft.category}
              onChange={(e) =>
                setDraft({ ...draft, category: e.target.value as AnnouncementCategory })
              }
            >
              <option value="announcement">Announcement (respects preferences)</option>
              <option value="essential">Essential (always sent)</option>
            </Select>
          )}
        </Field>

        <Field label="Title (in-app title and email subject)" error={fields.title}>
          {(ids) => (
            <Input
              {...ids}
              dir="auto"
              maxLength={ANNOUNCEMENT_LIMITS.titleMax}
              value={draft.title}
              onChange={(e) => setDraft({ ...draft, title: e.target.value })}
            />
          )}
        </Field>
        <Field label="Message (in the app and by email)" error={fields.body}>
          {(ids) => (
            <Textarea
              {...ids}
              rows={6}
              dir="auto"
              maxLength={ANNOUNCEMENT_LIMITS.bodyMax}
              value={draft.body}
              onChange={(e) => setDraft({ ...draft, body: e.target.value })}
            />
          )}
        </Field>
        {draft.channels.includes('sms') ? (
          <Field
            label="SMS text"
            hint={
              sms
                ? `${sms.segments} SMS part${sms.segments === 1 ? '' : 's'} per person (${sms.encoding === 'gsm7' ? 'plain text' : 'Arabic or special characters'}), counting {name} at its full 20 characters. At most 3 parts.`
                : 'Short: every part is billed for every person.'
            }
            error={fields.sms_body}
          >
            {(ids) => (
              <Textarea
                {...ids}
                rows={3}
                dir="auto"
                value={draft.sms_body}
                onChange={(e) => setDraft({ ...draft, sms_body: e.target.value })}
              />
            )}
          </Field>
        ) : null}

        {failure && Object.keys(failure.fields).length === 0 ? (
          <Notice kind="error">
            <p className="small">{failure.message}</p>
          </Notice>
        ) : null}
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <Button onClick={() => void save()} disabled={busy}>
            {busy ? 'Saving…' : 'Save draft'}
          </Button>
          {onCancel ? (
            <Button variant="ghost" onClick={onCancel} disabled={busy}>
              Cancel
            </Button>
          ) : null}
        </div>
      </CardBody>
    </Card>
  );
}
