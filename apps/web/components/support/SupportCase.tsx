'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';

import {
  CASE_PRIORITIES,
  CASE_PRIORITY_LABELS,
  CASE_TYPES,
  CASE_TYPE_LABELS,
  SUPPORT_STATUSES,
  SUPPORT_STATUS_LABELS,
  caseLabel,
  supportCaseEntrySchema,
  type CaseEntryKind,
  type CasePriority,
  type CaseType,
  type SupportAccountLink,
  type SupportCaseDetail,
  type SupportStatus,
} from '@agri-erp/shared';

import { formatDateTime } from '@/lib/admin/accounts-view';

import {
  Button,
  Card,
  EmptyState,
  Field,
  Input,
  Notice,
  PageHeader,
  Select,
  Stamp,
  Textarea,
} from '../ui';
import { LoadingState } from '../ui/data';
import { useToast } from '../ui/feedback';

/**
 * ONE SUPPORT CASE (2026-10-28). Who sent it and what they wrote; its type,
 * priority, the responsible staff member and status, with a resolution note
 * required to resolve or close; everything staff added (replies the person
 * reads on the Help page, internal notes, evidence links); and, when the
 * sender signed in or an appeal can be matched, the account -- where Restore
 * is for an appeal.
 */

const ENTRY_LABEL: Record<CaseEntryKind, string> = {
  reply: 'Reply to the person',
  note: 'Internal note',
  evidence: 'Evidence',
};

const accountHref = (a: SupportAccountLink) => `/admin/accounts/${a.kind}/${a.id}`;

interface Failure {
  message: string;
  fields: Record<string, string>;
}

async function send<T>(path: string, method: string, body: unknown): Promise<T> {
  let res: Response;
  try {
    res = await fetch(path, {
      method,
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
  } catch {
    throw { message: 'The server could not be reached. Check the connection.', fields: {} };
  }
  const json = (await res.json().catch(() => ({}))) as {
    data?: T;
    error?: { message?: string; fields?: Record<string, string> };
  };
  if (!res.ok || json.data === undefined) {
    throw {
      message: json.error?.message ?? `Not saved (${res.status}).`,
      fields: json.error?.fields ?? {},
    } satisfies Failure;
  }
  return json.data;
}

export function SupportCase({ id }: { id: string }) {
  const toast = useToast();
  const [detail, setDetail] = useState<SupportCaseDetail | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  // The case's own fields, edited together and saved with one button.
  const [status, setStatus] = useState<SupportStatus>('new');
  const [caseType, setCaseType] = useState<CaseType>('enquiry');
  const [priority, setPriority] = useState<CasePriority>('normal');
  const [assignee, setAssignee] = useState('');
  const [resolution, setResolution] = useState('');
  const [saving, setSaving] = useState(false);
  const [saveFailure, setSaveFailure] = useState<Failure | null>(null);

  // A new entry.
  const [kind, setKind] = useState<CaseEntryKind>('reply');
  const [body, setBody] = useState('');
  const [link, setLink] = useState('');
  const [moveToWaiting, setMoveToWaiting] = useState(true);
  const [adding, setAdding] = useState(false);
  const [entryFailure, setEntryFailure] = useState<Failure | null>(null);

  const load = useCallback(async () => {
    setLoadError(null);
    try {
      const res = await fetch(`/api/admin/support/${encodeURIComponent(id)}`, {
        cache: 'no-store',
      });
      const json = (await res.json().catch(() => ({}))) as {
        data?: SupportCaseDetail;
        error?: { message?: string };
      };
      if (!res.ok || !json.data) {
        throw new Error(
          res.status === 404
            ? 'This case was not found.'
            : res.status === 403
              ? 'Support cases are handled by staff with the "Assist users" permission.'
              : (json.error?.message ?? `Not loaded (${res.status}).`),
        );
      }
      const d = json.data;
      setDetail(d);
      setStatus(d.status);
      setCaseType(d.case_type);
      setPriority(d.priority);
      setAssignee(d.assignee?.id ?? '');
      setResolution(d.resolution_note ?? '');
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : 'Not loaded.');
    }
  }, [id]);

  useEffect(() => {
    void load();
  }, [load]);

  if (loadError) {
    return (
      <EmptyState
        error
        title="Case could not be loaded"
        body={loadError}
        actions={<Button onClick={() => void load()}>Try again</Button>}
      />
    );
  }
  if (!detail) return <LoadingState rows={6} />;

  const save = async () => {
    const patch: Record<string, unknown> = {};
    if (status !== detail.status) patch.status = status;
    if (caseType !== detail.case_type) patch.case_type = caseType;
    if (priority !== detail.priority) patch.priority = priority;
    if (assignee !== (detail.assignee?.id ?? '')) patch.assignee_id = assignee || null;
    if (resolution.trim() && resolution.trim() !== (detail.resolution_note ?? '')) {
      patch.resolution_note = resolution.trim();
    }
    if (Object.keys(patch).length === 0) {
      setSaveFailure({ message: 'Nothing has changed.', fields: {} });
      return;
    }
    setSaving(true);
    setSaveFailure(null);
    try {
      await send(`/api/admin/support/${encodeURIComponent(id)}`, 'PATCH', patch);
      toast.show({ kind: 'success', title: `${caseLabel(detail.case_number)} saved` });
      await load();
    } catch (e) {
      setSaveFailure(e as Failure);
    } finally {
      setSaving(false);
    }
  };

  const add = async () => {
    const input = {
      kind,
      body,
      ...(link.trim() ? { link: link.trim() } : {}),
      ...(kind === 'reply' && moveToWaiting && detail.status !== 'waiting'
        ? { status: 'waiting' }
        : {}),
    };
    const parsed = supportCaseEntrySchema.safeParse(input);
    if (!parsed.success) {
      const fields: Record<string, string> = {};
      for (const issue of parsed.error.issues) {
        const k = String(issue.path[0] ?? 'body');
        fields[k] ??= issue.message;
      }
      setEntryFailure({ message: 'Check the entry.', fields });
      return;
    }
    setAdding(true);
    setEntryFailure(null);
    try {
      const out = await send<{ notified: boolean }>(
        `/api/admin/support/${encodeURIComponent(id)}/entries`,
        'POST',
        parsed.data,
      );
      toast.show({
        kind: kind === 'reply' && !out.notified ? 'warn' : 'success',
        title: kind === 'reply' ? 'Reply saved' : `${ENTRY_LABEL[kind]} added`,
        ...(kind === 'reply'
          ? {
              body: out.notified
                ? 'The person was told in the app and reads it on the Help page.'
                : 'This person has no AgriOne inbox. Answer them by the phone or email they gave.',
            }
          : {}),
      });
      setBody('');
      setLink('');
      await load();
    } catch (e) {
      setEntryFailure(e as Failure);
    } finally {
      setAdding(false);
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--s-6)' }}>
      <p className="small">
        <Link href="/admin/support">← Support cases</Link>
      </p>
      <PageHeader
        title={`Case ${caseLabel(detail.case_number)}`}
        subtitle={`${CASE_TYPE_LABELS[detail.case_type]} · opened ${formatDateTime(detail.created_at)}`}
      />

      <div
        style={{
          display: 'grid',
          gap: 'var(--s-4)',
          gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 340px), 1fr))',
        }}
      >
        <Card padded>
          <p className="label">From</p>
          <p dir="auto">
            <strong>{detail.name}</strong>{' '}
            <span className="small muted">
              ·{' '}
              {detail.from_kind === 'visitor'
                ? 'Visitor (not signed in)'
                : `${detail.from_kind === 'farmer' ? 'Farmer' : 'Buyer'} (signed in)`}
            </span>
          </p>
          <p className="small">
            {detail.phone ? <span className="mono">{detail.phone}</span> : null}
            {detail.phone && detail.email ? ' · ' : null}
            {detail.email ? <span>{detail.email}</span> : null}
          </p>
          <p dir="auto" style={{ whiteSpace: 'pre-wrap' }}>
            {detail.body}
          </p>
          {detail.account ? (
            <p className="small">
              <Link href={accountHref(detail.account)}>Open the account</Link>
              {detail.account.suspended ? ' · suspended now' : ''}
              {detail.account.matched_by === 'phone'
                ? ' · found by the phone number given; check it is the same person'
                : ''}
              {detail.case_type === 'appeal' ? '. Restore is on the account page.' : ''}
            </p>
          ) : detail.case_type === 'appeal' ? (
            <p className="small muted">
              No account could be matched to this appeal. Find it in Users and organizations by the
              name or phone above.
            </p>
          ) : null}
        </Card>

        <Card padded>
          <p className="label">Case</p>
          {saveFailure && Object.keys(saveFailure.fields).length === 0 ? (
            <Notice kind="error">{saveFailure.message}</Notice>
          ) : null}
          <div style={{ display: 'grid', gap: 'var(--s-3)' }}>
            <Field label="Status" error={saveFailure?.fields.status}>
              {(ids) => (
                <Select
                  {...ids}
                  value={status}
                  onChange={(e) => setStatus(e.target.value as SupportStatus)}
                >
                  {SUPPORT_STATUSES.map((s) => (
                    <option key={s} value={s} disabled={s === 'new' && detail.status !== 'new'}>
                      {SUPPORT_STATUS_LABELS[s]}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
            <Field label="Type" error={saveFailure?.fields.case_type}>
              {(ids) => (
                <Select
                  {...ids}
                  value={caseType}
                  onChange={(e) => setCaseType(e.target.value as CaseType)}
                >
                  {CASE_TYPES.map((t) => (
                    <option key={t} value={t}>
                      {CASE_TYPE_LABELS[t]}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
            <Field label="Priority" error={saveFailure?.fields.priority}>
              {(ids) => (
                <Select
                  {...ids}
                  value={priority}
                  onChange={(e) => setPriority(e.target.value as CasePriority)}
                >
                  {CASE_PRIORITIES.map((p) => (
                    <option key={p} value={p}>
                      {CASE_PRIORITY_LABELS[p]}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
            <Field label="Responsible staff member" error={saveFailure?.fields.assignee_id}>
              {(ids) => (
                <Select {...ids} value={assignee} onChange={(e) => setAssignee(e.target.value)}>
                  <option value="">Nobody yet</option>
                  {detail.assignable.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
            <Field
              label="Resolution note"
              hint="Required to resolve or close. What was done, and the outcome."
              error={saveFailure?.fields.resolution_note}
            >
              {(ids) => (
                <Textarea
                  {...ids}
                  rows={3}
                  maxLength={2000}
                  dir="auto"
                  value={resolution}
                  onChange={(e) => setResolution(e.target.value)}
                />
              )}
            </Field>
            <div>
              <Button variant="primary" disabled={saving} onClick={() => void save()}>
                {saving ? 'Saving…' : 'Save case'}
              </Button>
            </div>
            <p className="small muted">
              Last changed {formatDateTime(detail.updated_at)}
              {detail.handled_at ? ` · settled ${formatDateTime(detail.handled_at)}` : ''}.
            </p>
          </div>
        </Card>
      </div>

      <Card padded>
        <p className="label">History</p>
        {detail.entries.length === 0 ? (
          <p className="small muted">Nothing added yet.</p>
        ) : (
          <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'grid', gap: 12 }}>
            {detail.entries.map((e) => (
              <li
                key={e.id}
                style={{ borderInlineStart: '3px solid var(--line)', paddingInlineStart: 12 }}
              >
                <p className="small">
                  <Stamp
                    kind={
                      e.kind === 'reply' ? 'verified' : e.kind === 'evidence' ? 'info' : 'neutral'
                    }
                  >
                    {ENTRY_LABEL[e.kind]}
                  </Stamp>{' '}
                  {e.author.name} · {formatDateTime(e.created_at)}
                </p>
                <p dir="auto" style={{ whiteSpace: 'pre-wrap' }}>
                  {e.body}
                </p>
                {e.link ? (
                  <p className="small">
                    <a href={e.link} target="_blank" rel="noopener noreferrer nofollow">
                      {e.link}
                    </a>
                  </p>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card padded>
        <p className="label">Add to the case</p>
        {entryFailure && Object.keys(entryFailure.fields).length === 0 ? (
          <Notice kind="error">{entryFailure.message}</Notice>
        ) : null}
        <div style={{ display: 'grid', gap: 'var(--s-3)' }}>
          <Field label="What">
            {(ids) => (
              <Select
                {...ids}
                value={kind}
                onChange={(e) => setKind(e.target.value as CaseEntryKind)}
              >
                <option value="reply">Reply to the person (they read it in the app)</option>
                <option value="note">Internal note (staff only)</option>
                <option value="evidence">Evidence link (staff only)</option>
              </Select>
            )}
          </Field>
          <Field
            label={kind === 'evidence' ? 'What the evidence is' : 'Text'}
            error={entryFailure?.fields.body}
          >
            {(ids) => (
              <Textarea
                {...ids}
                rows={4}
                maxLength={2000}
                dir="auto"
                value={body}
                onChange={(e) => setBody(e.target.value)}
              />
            )}
          </Field>
          <Field
            label="Link"
            optional={kind !== 'evidence'}
            hint="A web address starting http:// or https://"
            error={entryFailure?.fields.link}
          >
            {(ids) => (
              <Input
                {...ids}
                type="url"
                inputMode="url"
                value={link}
                onChange={(e) => setLink(e.target.value)}
              />
            )}
          </Field>
          {kind === 'reply' && detail.status !== 'waiting' ? (
            <label className="small" style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <input
                type="checkbox"
                checked={moveToWaiting}
                onChange={(e) => setMoveToWaiting(e.target.checked)}
              />
              Mark the case as waiting for the person
            </label>
          ) : null}
          {kind === 'reply' && detail.from_kind === 'visitor' ? (
            <Notice kind="warn">
              This person was not signed in, so they cannot read a reply in the app. Keep the reply
              here for the record and answer them by phone or email.
            </Notice>
          ) : null}
          <div>
            <Button variant="primary" disabled={adding} onClick={() => void add()}>
              {adding ? 'Saving…' : kind === 'reply' ? 'Send reply' : 'Add'}
            </Button>
          </div>
        </div>
      </Card>
    </div>
  );
}
