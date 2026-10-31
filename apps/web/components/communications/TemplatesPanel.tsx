'use client';

import { useCallback, useEffect, useState } from 'react';

import {
  ANNOUNCEMENT_CHANNELS,
  ANNOUNCEMENT_LIMITS,
  smsEstimate,
  templateCreateSchema,
  templateEditSchema,
  type AnnouncementChannel,
  type MessageTemplate,
  type TemplateStatus,
} from '@agri-erp/shared';

import {
  Badge,
  Button,
  Card,
  CardBody,
  CardHeader,
  Field,
  Input,
  Notice,
  Select,
  Textarea,
} from '@/components/ui';
import { formatDate } from '@/lib/format';
import {
  asFailure,
  createTemplate,
  listTemplates,
  updateTemplate,
  type Failure,
} from '@/lib/communications/announcements';

import { CHANNEL_LABELS } from './AnnouncementComposer';

const STATUS_TONE: Record<TemplateStatus, 'leaf' | 'sorghum' | 'neutral'> = {
  active: 'leaf',
  draft: 'sorghum',
  archived: 'neutral',
};
const STATUS_LABEL: Record<TemplateStatus, string> = {
  active: 'Active',
  draft: 'Draft',
  archived: 'Archived',
};

function issues(error: { issues: { path: PropertyKey[]; message: string }[] }) {
  const out: Record<string, string> = {};
  for (const issue of error.issues)
    out[issue.path.map(String).join('.') || 'body'] ??= issue.message;
  return out;
}

/**
 * MESSAGE TEMPLATES (2026-10-27). Saved texts for one channel each, used to
 * start an announcement. Draft, active (offered in the composer) or archived
 * (kept, because an announcement may name it, and restorable). Nothing here
 * sends anything.
 */
export function TemplatesPanel() {
  const [templates, setTemplates] = useState<MessageTemplate[] | null>(null);
  const [failure, setFailure] = useState<Failure | null>(null);
  const [editing, setEditing] = useState<MessageTemplate | 'new' | null>(null);

  const load = useCallback(async () => {
    setFailure(null);
    try {
      setTemplates(await listTemplates());
    } catch (e) {
      setFailure(asFailure(e));
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const setStatus = async (t: MessageTemplate, status: TemplateStatus) => {
    try {
      await updateTemplate(t.id, { status });
      await load();
    } catch (e) {
      setFailure(asFailure(e));
    }
  };

  return (
    <div style={{ display: 'grid', gap: 'var(--s-4)' }}>
      {failure ? (
        <Notice kind="error" title="Templates could not be loaded or changed">
          <p className="small">{failure.message}</p>
        </Notice>
      ) : null}
      {editing ? (
        <TemplateForm
          template={editing === 'new' ? null : editing}
          onDone={() => {
            setEditing(null);
            void load();
          }}
        />
      ) : (
        <div>
          <Button onClick={() => setEditing('new')}>New template</Button>
        </div>
      )}
      {templates === null && !failure ? <p className="muted">Loading…</p> : null}
      {templates && templates.length === 0 ? <p className="muted">No templates yet.</p> : null}
      {templates?.map((t) => (
        <Card key={t.id}>
          <CardHeader
            title={
              <>
                {t.name} <Badge tone={STATUS_TONE[t.status]}>{STATUS_LABEL[t.status]}</Badge>
              </>
            }
            subtitle={`${CHANNEL_LABELS[t.channel]} · saved ${formatDate(t.updated_at)}${t.updated_by ? ` by ${t.updated_by}` : ''}`}
            actions={
              <>
                <Button size="small" variant="secondary" onClick={() => setEditing(t)}>
                  Edit
                </Button>
                {t.status !== 'active' ? (
                  <Button
                    size="small"
                    variant="secondary"
                    onClick={() => void setStatus(t, 'active')}
                  >
                    {t.status === 'archived' ? 'Restore' : 'Make active'}
                  </Button>
                ) : null}
                {t.status !== 'archived' ? (
                  <Button
                    size="small"
                    variant="ghost"
                    onClick={() => void setStatus(t, 'archived')}
                  >
                    Archive
                  </Button>
                ) : null}
              </>
            }
          />
          <CardBody>
            {t.title ? (
              <p dir="auto">
                <strong>{t.title}</strong>
              </p>
            ) : null}
            <p className="small" dir="auto" style={{ whiteSpace: 'pre-wrap' }}>
              {t.body}
            </p>
          </CardBody>
        </Card>
      ))}
    </div>
  );
}

function TemplateForm({
  template,
  onDone,
}: {
  template: MessageTemplate | null;
  onDone: () => void;
}) {
  const [name, setName] = useState(template?.name ?? '');
  const [channel, setChannel] = useState<AnnouncementChannel>(template?.channel ?? 'in_app');
  const [title, setTitle] = useState(template?.title ?? '');
  const [body, setBody] = useState(template?.body ?? '');
  const [fields, setFields] = useState<Record<string, string>>({});
  const [failure, setFailure] = useState<Failure | null>(null);
  const [busy, setBusy] = useState(false);

  const isSms = channel === 'sms';
  const sms = isSms && body ? smsEstimate(body, 'AgriOne South Sudan') : null;

  const save = async () => {
    setFailure(null);
    const input = template
      ? { name, title: isSms ? null : title, body }
      : { name, channel, title: isSms ? null : title, body };
    const parsed = template
      ? templateEditSchema.safeParse(input)
      : templateCreateSchema.safeParse(input);
    if (!parsed.success) {
      setFields(issues(parsed.error));
      return;
    }
    setFields({});
    setBusy(true);
    try {
      if (template) await updateTemplate(template.id, parsed.data);
      else await createTemplate(parsed.data);
      onDone();
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
        title={template ? 'Edit template' : 'New template'}
        subtitle="A new template is a draft until you make it active. Placeholders: {name} and {service_name}."
      />
      <CardBody>
        <Field label="Name (for staff)" error={fields.name}>
          {(ids) => (
            <Input
              {...ids}
              maxLength={ANNOUNCEMENT_LIMITS.templateNameMax}
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          )}
        </Field>
        <Field
          label="Channel"
          hint={template ? 'A template keeps its channel.' : undefined}
          error={fields.channel}
        >
          {(ids) => (
            <Select
              {...ids}
              value={channel}
              disabled={template !== null}
              onChange={(e) => setChannel(e.target.value as AnnouncementChannel)}
            >
              {ANNOUNCEMENT_CHANNELS.map((c) => (
                <option key={c} value={c}>
                  {CHANNEL_LABELS[c]}
                </option>
              ))}
            </Select>
          )}
        </Field>
        {!isSms ? (
          <Field label="Title" error={fields.title}>
            {(ids) => (
              <Input
                {...ids}
                dir="auto"
                maxLength={ANNOUNCEMENT_LIMITS.titleMax}
                value={title}
                onChange={(e) => setTitle(e.target.value)}
              />
            )}
          </Field>
        ) : null}
        <Field
          label="Text"
          hint={
            sms
              ? `${sms.segments} SMS part${sms.segments === 1 ? '' : 's'} per person, at most 3.`
              : undefined
          }
          error={fields.body}
        >
          {(ids) => (
            <Textarea
              {...ids}
              rows={isSms ? 3 : 6}
              dir="auto"
              maxLength={ANNOUNCEMENT_LIMITS.bodyMax}
              value={body}
              onChange={(e) => setBody(e.target.value)}
            />
          )}
        </Field>
        {failure && Object.keys(failure.fields).length === 0 ? (
          <Notice kind="error">
            <p className="small">{failure.message}</p>
          </Notice>
        ) : null}
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <Button onClick={() => void save()} disabled={busy}>
            {busy ? 'Saving…' : 'Save template'}
          </Button>
          <Button variant="ghost" onClick={onDone} disabled={busy}>
            Cancel
          </Button>
        </div>
      </CardBody>
    </Card>
  );
}
