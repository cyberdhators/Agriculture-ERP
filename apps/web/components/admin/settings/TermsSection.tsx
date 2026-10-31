'use client';

import { useCallback, useEffect, useState } from 'react';

import {
  NOTICE_KINDS,
  NOTICE_LANGUAGES,
  SETTINGS_LIMITS,
  noticeDraftSchema,
  noticeEditSchema,
  type NoticeLanguage,
  type PolicyNoticeKind,
  type StaffNotice,
} from '@agri-erp/shared';

import {
  Button,
  Card,
  CardBody,
  CardHeader,
  Dialog,
  Field,
  Input,
  Notice,
  Select,
  Stamp,
  Textarea,
  type StampKind,
} from '@/components/ui';
import { ConfirmationDialog } from '@/components/ui/feedback';
import { formatDate } from '@/lib/format';

import { asFailure, call, json, type Failure } from './api';

const KIND_LABEL: Record<PolicyNoticeKind, string> = {
  consent: 'Consent',
  terms: 'Terms of use',
  privacy: 'Privacy notice',
};

const LANGUAGE_LABEL: Record<NoticeLanguage, string> = { en: 'English', ar: 'Arabic' };

const STATUS: Record<StaffNotice['status'], { label: string; stamp: StampKind }> = {
  draft: { label: 'Draft', stamp: 'pending' },
  published: { label: 'Published', stamp: 'verified' },
  retired: { label: 'Retired', stamp: 'neutral' },
};

interface Acknowledgement {
  text_version: string;
  language: string;
  accepted: number;
  current: number;
}

/**
 * The open retention decisions, stated as they are (2026-10-25). Read-only:
 * nothing here deletes anything, and no purge exists. Deciding them is for
 * CORWADO; until then the records are kept.
 */
const RETENTION: ReadonlyArray<{ what: string; now: string }> = [
  { what: 'Messages between users', now: 'Not set: kept indefinitely.' },
  { what: 'Access logs (sign-ins and sessions)', now: 'Not set: kept indefinitely.' },
  {
    what: 'Deleted accounts',
    now: 'Not set: kept indefinitely, soft-deleted (hidden from every list and count, never erased).',
  },
];

/**
 * TERMS AND DATA (settings phase 1): versioned notices (consent, terms,
 * privacy) with draft, preview and publish; how many accounts accepted each
 * consent version (counts only); and the retention decisions still open.
 */
export function TermsSection() {
  const [notices, setNotices] = useState<StaffNotice[] | null>(null);
  const [failure, setFailure] = useState<Failure | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [editing, setEditing] = useState<StaffNotice | 'new' | null>(null);
  const [preview, setPreview] = useState<StaffNotice | null>(null);
  const [publishing, setPublishing] = useState<StaffNotice | null>(null);
  const [discarding, setDiscarding] = useState<StaffNotice | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      setNotices(await call<StaffNotice[]>('/api/admin/notices'));
      setFailure(null);
    } catch (e) {
      setNotices([]);
      setFailure(asFailure(e));
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const act = async (run: () => Promise<unknown>, message: string) => {
    setBusy(true);
    setFailure(null);
    try {
      await run();
      setDone(message);
      setPublishing(null);
      setDiscarding(null);
      await load();
    } catch (e) {
      setFailure(asFailure(e));
      setPublishing(null);
      setDiscarding(null);
    } finally {
      setBusy(false);
    }
  };

  const publishedFor = (n: StaffNotice) =>
    notices?.find(
      (o) => o.kind === n.kind && o.language === n.language && o.status === 'published',
    );

  return (
    <div style={{ display: 'grid', gap: 'var(--s-4)' }}>
      <Card>
        <CardHeader
          title="Versioned notices"
          subtitle="Consent, terms and privacy texts. A draft is private until published."
          actions={
            <Button size="small" onClick={() => setEditing('new')}>
              New draft
            </Button>
          }
        />
        <CardBody>
          {failure ? (
            <Notice kind="error">
              <p className="small">{failure.message}</p>
            </Notice>
          ) : null}
          {done ? <Notice kind="success">{done}</Notice> : null}
          {notices === null ? (
            <p className="muted">Loading…</p>
          ) : notices.length === 0 ? (
            <p className="small muted">No notice has been stored yet.</p>
          ) : (
            <div style={{ overflowX: 'auto' }}>
              <table className="small" style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr style={{ textAlign: 'start' }}>
                    <th style={{ textAlign: 'start' }}>Notice</th>
                    <th style={{ textAlign: 'start' }}>Language</th>
                    <th style={{ textAlign: 'start' }}>Version</th>
                    <th style={{ textAlign: 'start' }}>Status</th>
                    <th style={{ textAlign: 'start' }}>Dates</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {notices.map((n) => (
                    <tr key={n.id} style={{ borderTop: '1px solid var(--line)' }}>
                      <td>{KIND_LABEL[n.kind]}</td>
                      <td>{LANGUAGE_LABEL[n.language]}</td>
                      <td className="mono">{n.text_version}</td>
                      <td>
                        <Stamp kind={STATUS[n.status].stamp}>{STATUS[n.status].label}</Stamp>
                      </td>
                      <td>
                        {n.published_at ? `Published ${formatDate(n.published_at)}` : null}
                        {n.retired_at ? ` · retired ${formatDate(n.retired_at)}` : null}
                        {n.status === 'draft' ? `Drafted ${formatDate(n.created_at)}` : null}
                      </td>
                      <td>
                        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                          <Button size="small" variant="ghost" onClick={() => setPreview(n)}>
                            Preview
                          </Button>
                          {n.status === 'draft' ? (
                            <>
                              <Button
                                size="small"
                                variant="secondary"
                                onClick={() => setEditing(n)}
                              >
                                Edit
                              </Button>
                              <Button size="small" onClick={() => setPublishing(n)}>
                                Publish
                              </Button>
                              <Button size="small" variant="ghost" onClick={() => setDiscarding(n)}>
                                Discard
                              </Button>
                            </>
                          ) : null}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <p className="small muted">Consents already given keep the version they recorded.</p>
        </CardBody>
      </Card>

      <Acknowledgements />

      <Card>
        <CardHeader
          title="Retention"
          subtitle="How long records are kept. These decisions are still open; nothing is purged."
        />
        <CardBody>
          <dl className="small" style={{ display: 'grid', gap: 8, margin: 0 }}>
            {RETENTION.map((r) => (
              <div key={r.what}>
                <dt>
                  <strong>{r.what}</strong>
                </dt>
                <dd style={{ margin: 0 }}>{r.now}</dd>
              </div>
            ))}
          </dl>
        </CardBody>
      </Card>

      {editing ? (
        <NoticeEditor
          notice={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={(message) => {
            setEditing(null);
            setDone(message);
            void load();
          }}
        />
      ) : null}

      <Dialog
        open={preview !== null}
        onClose={() => setPreview(null)}
        title={
          preview
            ? `${KIND_LABEL[preview.kind]} · ${LANGUAGE_LABEL[preview.language]} · ${preview.text_version}`
            : 'Preview'
        }
        footer={
          <Button variant="ghost" onClick={() => setPreview(null)}>
            Close
          </Button>
        }
      >
        {preview ? (
          <>
            <p className="small muted">As a person signing up sees it:</p>
            <div
              dir={preview.language === 'ar' ? 'rtl' : 'ltr'}
              lang={preview.language}
              style={{
                whiteSpace: 'pre-line',
                border: '1px solid var(--line)',
                borderRadius: 8,
                padding: 12,
              }}
            >
              {preview.body}
            </div>
            <p className="small muted mono">{preview.text_version}</p>
          </>
        ) : null}
      </Dialog>

      <ConfirmationDialog
        open={publishing !== null}
        onCancel={() => setPublishing(null)}
        onConfirm={() =>
          publishing &&
          void act(
            () => call(`/api/admin/notices/${publishing.id}/publish`, { method: 'POST' }),
            `${publishing.text_version} is published.`,
          )
        }
        title="Publish this notice?"
        consequence={
          publishing
            ? `${KIND_LABEL[publishing.kind]} in ${LANGUAGE_LABEL[publishing.language]}, version ${publishing.version}, becomes the text everyone sees from now on.${
                publishedFor(publishing)
                  ? ` ${publishedFor(publishing)?.text_version} is retired and kept.`
                  : ''
              }`
            : ''
        }
        confirmLabel="Publish"
        busy={busy}
      />

      <ConfirmationDialog
        open={discarding !== null}
        onCancel={() => setDiscarding(null)}
        onConfirm={() =>
          discarding &&
          void act(
            () => call(`/api/admin/notices/${discarding.id}`, { method: 'DELETE' }),
            'The draft was discarded.',
          )
        }
        title="Discard this draft?"
        consequence="Nobody has seen a draft. It is removed from this list; the audit trail keeps the record that it existed."
        confirmLabel="Discard draft"
        destructive
        busy={busy}
      />
    </div>
  );
}

function NoticeEditor({
  notice,
  onClose,
  onSaved,
}: {
  notice: StaffNotice | null;
  onClose: () => void;
  onSaved: (message: string) => void;
}) {
  const [kind, setKind] = useState<PolicyNoticeKind>(notice?.kind ?? 'consent');
  const [language, setLanguage] = useState<NoticeLanguage>(notice?.language ?? 'en');
  const [version, setVersion] = useState(notice?.version ?? '');
  const [body, setBody] = useState(notice?.body ?? '');
  const [fields, setFields] = useState<Record<string, string>>({});
  const [failure, setFailure] = useState<Failure | null>(null);
  const [busy, setBusy] = useState(false);

  const save = async () => {
    setFailure(null);
    const input = notice
      ? {
          ...(version.trim() !== notice.version ? { version } : {}),
          ...(body.trim() !== notice.body ? { body } : {}),
        }
      : { kind, language, version, body };
    const parsed = notice ? noticeEditSchema.safeParse(input) : noticeDraftSchema.safeParse(input);
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
      if (notice) {
        await call(`/api/admin/notices/${notice.id}`, json('PATCH', parsed.data));
        onSaved('The draft was saved.');
      } else {
        await call('/api/admin/notices', json('POST', parsed.data));
        onSaved('The draft was created. Preview it, then publish it when it is ready.');
      }
    } catch (e) {
      const f = asFailure(e);
      setFailure(f);
      setFields(f.fields);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog
      open
      onClose={onClose}
      title={notice ? `Edit draft ${notice.text_version}` : 'New draft notice'}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button onClick={() => void save()} disabled={busy}>
            {busy ? 'Saving…' : 'Save draft'}
          </Button>
        </>
      }
    >
      {failure && Object.keys(failure.fields).length === 0 ? (
        <Notice kind="error">
          <p className="small">{failure.message}</p>
        </Notice>
      ) : null}
      {!notice ? (
        <>
          <Field label="Notice" error={fields.kind}>
            {(ids) => (
              <Select
                {...ids}
                value={kind}
                onChange={(e) => setKind(e.target.value as PolicyNoticeKind)}
              >
                {NOTICE_KINDS.map((k) => (
                  <option key={k} value={k}>
                    {KIND_LABEL[k]}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <Field label="Language" error={fields.language}>
            {(ids) => (
              <Select
                {...ids}
                value={language}
                onChange={(e) => setLanguage(e.target.value as NoticeLanguage)}
              >
                {NOTICE_LANGUAGES.map((l) => (
                  <option key={l} value={l}>
                    {LANGUAGE_LABEL[l]}
                  </option>
                ))}
              </Select>
            )}
          </Field>
        </>
      ) : null}
      <Field
        label="Version"
        hint="v followed by numbers, higher than the published one, such as v1.4."
        error={fields.version}
      >
        {(ids) => (
          <Input
            {...ids}
            dir="ltr"
            maxLength={SETTINGS_LIMITS.noticeVersionMax}
            value={version}
            onChange={(e) => setVersion(e.target.value)}
          />
        )}
      </Field>
      <Field
        label="Text"
        hint={`${SETTINGS_LIMITS.noticeBodyMin} to ${SETTINGS_LIMITS.noticeBodyMax} characters.`}
        error={fields.body}
      >
        {(ids) => (
          <Textarea
            {...ids}
            rows={10}
            dir={(notice?.language ?? language) === 'ar' ? 'rtl' : 'ltr'}
            maxLength={SETTINGS_LIMITS.noticeBodyMax}
            value={body}
            onChange={(e) => setBody(e.target.value)}
          />
        )}
      </Field>
    </Dialog>
  );
}

function Acknowledgements() {
  const [rows, setRows] = useState<Acknowledgement[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    call<Acknowledgement[]>('/api/admin/notices/acknowledgements')
      .then(setRows)
      .catch((e: unknown) => setError(asFailure(e).message));
  }, []);

  return (
    <Card>
      <CardHeader
        title="Acknowledgement history"
        subtitle="Accounts that accepted each consent version. Counts only."
      />
      <CardBody>
        {error ? (
          <Notice kind="error">
            <p className="small">{error}</p>
          </Notice>
        ) : rows === null ? (
          <p className="muted">Loading…</p>
        ) : rows.length === 0 ? (
          <p className="small muted">No consent has been recorded yet.</p>
        ) : (
          <table className="small" style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr>
                <th style={{ textAlign: 'start' }}>Version</th>
                <th style={{ textAlign: 'start' }}>Language</th>
                <th style={{ textAlign: 'end' }}>Accepted</th>
                <th style={{ textAlign: 'end' }}>Still current</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr
                  key={`${r.text_version}-${r.language}`}
                  style={{ borderTop: '1px solid var(--line)' }}
                >
                  <td className="mono">{r.text_version}</td>
                  <td>{LANGUAGE_LABEL[r.language as NoticeLanguage] ?? r.language}</td>
                  <td className="mono" style={{ textAlign: 'end' }}>
                    {r.accepted}
                  </td>
                  <td className="mono" style={{ textAlign: 'end' }}>
                    {r.current}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <p className="small muted">
          Accepted: registrations that agreed to that version (live records only). Still current: of
          those, how many have it as their consent today, not withdrawn.
        </p>
      </CardBody>
    </Card>
  );
}
