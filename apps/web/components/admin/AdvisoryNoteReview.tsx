'use client';

import { useCallback, useEffect, useState } from 'react';

import {
  ADVISORY_NOTE_LIMITS,
  ADVISORY_NOTE_RULES,
  type AdvisoryNoteReviewAction,
  type AdvisoryNoteStaff,
  type AdvisoryNoteStatus,
} from '@agri-erp/shared';

import { Badge, Button, Card, Field, Notice, Tabs, Textarea } from '@/components/ui';
import { TOPIC_KEY } from '@/lib/advice/labels';
import { formatDate } from '@/lib/format';
import { t } from '@/lib/i18n';

/**
 * OFFICIAL ADVISORY NOTES -- STAFF REVIEW (2026-10-28, lane-security). Notes
 * sent by approved advisers, in Advice & Learning's review: return with a
 * note (content.moderate or content.publish), publish or unpublish
 * (content.publish only -- publishing authority is separately assigned). The
 * server decides; a 403 here means this account reviews nothing, and the
 * section is not shown.
 */

const TABS: { key: AdvisoryNoteStatus; label: string }[] = [
  { key: 'submitted', label: 'Waiting for review' },
  { key: 'returned', label: 'Returned' },
  { key: 'published', label: 'Published' },
  { key: 'unpublished', label: 'Unpublished' },
];

const ACTION_LABEL: Record<AdvisoryNoteReviewAction, string> = {
  return: 'Return to adviser',
  publish: 'Publish',
  unpublish: 'Unpublish',
};

export function AdvisoryNoteReview() {
  const [tab, setTab] = useState<AdvisoryNoteStatus>('submitted');
  const [rows, setRows] = useState<AdvisoryNoteStaff[] | null>(null);
  const [hidden, setHidden] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/admin/advisory-notes?status=${tab}`, { cache: 'no-store' });
      if (res.status === 403) {
        setHidden(true);
        return;
      }
      const body = (await res.json().catch(() => ({}))) as {
        data?: AdvisoryNoteStaff[];
        error?: { message?: string };
      };
      if (!res.ok) {
        setFailure(body.error?.message ?? 'The notes could not be loaded.');
        return;
      }
      setRows(body.data ?? []);
      setFailure(null);
    } catch {
      setFailure('The server could not be reached. Check the connection.');
    }
  }, [tab]);

  useEffect(() => {
    void load();
  }, [load]);

  if (hidden) return null;

  return (
    <section style={{ display: 'grid', gap: 'var(--s-3)', marginTop: 'var(--s-6)' }}>
      <h2>Official advisory notes</h2>
      <p className="small muted">
        Short notes from approved advisers. Publishing puts a note on the adviser&rsquo;s public
        profile as &ldquo;Reviewed by CORWADO&rdquo;. Only staff who can publish content may publish
        or unpublish.
      </p>
      <Tabs items={TABS} value={tab} onChange={(k) => setTab(k)} label="Note status" />
      {failure ? <Notice kind="error">{failure}</Notice> : null}
      {rows && rows.length === 0 ? <p className="small muted">Nothing here.</p> : null}
      {(rows ?? []).map((n) => (
        <NoteCard key={n.id} note={n} onDone={() => void load()} />
      ))}
    </section>
  );
}

function NoteCard({ note: n, onDone }: { note: AdvisoryNoteStaff; onDone: () => void }) {
  const [action, setAction] = useState<AdvisoryNoteReviewAction | null>(null);
  const [text, setText] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const allowed = (Object.keys(ADVISORY_NOTE_RULES) as AdvisoryNoteReviewAction[]).filter((a) =>
    (ADVISORY_NOTE_RULES[a].from as readonly string[]).includes(n.status),
  );

  const decide = async (a: AdvisoryNoteReviewAction) => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/admin/advisory-notes/${encodeURIComponent(n.id)}/review`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action: a, ...(text.trim() ? { note: text.trim() } : {}) }),
      });
      const body = (await res.json().catch(() => ({}))) as {
        error?: { message?: string; fields?: Record<string, string> };
      };
      if (!res.ok) {
        setError(body.error?.fields?.note ?? body.error?.message ?? 'Not saved.');
        return;
      }
      setAction(null);
      setText('');
      onDone();
    } catch {
      setError('The server could not be reached. Check the connection.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card padded>
      <p>
        <strong dir="auto">{n.title}</strong>{' '}
        <span className="small muted">
          · {n.provider.display_name} · {formatDate(n.updated_at)}
        </span>{' '}
        {n.provider.approval_active ? null : <Badge tone="clay">Approval not active</Badge>}
      </p>
      <p className="small muted">{n.topics.map((v) => t(TOPIC_KEY[v])).join(' · ')}</p>
      <p dir="auto" style={{ whiteSpace: 'pre-wrap' }}>
        {n.body}
      </p>
      {n.review_note ? (
        <p className="small">
          Staff note: <span dir="auto">{n.review_note}</span>
          {n.reviewed_by_name ? ` · ${n.reviewed_by_name}` : ''}
        </p>
      ) : null}
      {action ? (
        <div style={{ display: 'grid', gap: 'var(--s-2)' }}>
          {ADVISORY_NOTE_RULES[action].needsNote ? (
            <Field label="Note to the adviser" hint="5 to 1000 characters. They see it.">
              {(ids) => (
                <Textarea
                  {...ids}
                  rows={3}
                  maxLength={ADVISORY_NOTE_LIMITS.noteMax}
                  value={text}
                  onChange={(e) => setText(e.target.value)}
                />
              )}
            </Field>
          ) : null}
          {error ? <Notice kind="error">{error}</Notice> : null}
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <Button
              size="small"
              variant="primary"
              disabled={busy}
              onClick={() => void decide(action)}
            >
              {busy ? 'Saving…' : ACTION_LABEL[action]}
            </Button>
            <Button size="small" variant="ghost" disabled={busy} onClick={() => setAction(null)}>
              Cancel
            </Button>
          </div>
        </div>
      ) : allowed.length > 0 ? (
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {allowed.map((a) => (
            <Button
              key={a}
              size="small"
              variant={a === 'publish' ? 'primary' : 'secondary'}
              onClick={() => {
                setText('');
                setError(null);
                setAction(a);
              }}
            >
              {ACTION_LABEL[a]}
            </Button>
          ))}
        </div>
      ) : null}
    </Card>
  );
}
