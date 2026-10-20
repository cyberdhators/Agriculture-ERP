'use client';

import { useCallback, useEffect, useState, type ReactNode } from 'react';

import {
  ADVISER_DECISION_RULES,
  ADVISER_LIMITS,
  type AdviserApplicationStaff,
  type AdviserApplicationStatus,
  type AdviserDecision,
} from '@agri-erp/shared';

import { Button, Card, Field, Notice, Stamp, Tabs, Textarea, type StampKind } from '@/components/ui';
import { ConfirmationDialog } from '@/components/ui/feedback';
import { KIND_KEY, LANGUAGE_KEY, TOPIC_KEY } from '@/lib/advice/labels';
import { formatDate } from '@/lib/format';
import { t } from '@/lib/i18n';
import { usePreview } from '@/lib/preview';

/**
 * APPROVED ADVISERS -- THE STAFF QUEUE (2026-10-24). Administrators holding
 * "Moderate content and listings" (content.moderate); the routes answer 403
 * to anyone else, and then this says so and shows nothing.
 *
 * Tabs by status; each application shows what the applicant wrote and their
 * advice profile, and the decisions its status allows -- request
 * clarification, approve, decline, revoke -- each through a dialog that
 * requires a reason, which the audit trail keeps. Approval adds the
 * "Approved adviser" badge only; it never changes the account's ordinary
 * access, and account suspension or restoration never changes it.
 */

type Tab = Exclude<AdviserApplicationStatus, 'withdrawn'>;

const TABS: { key: Tab; label: string }[] = [
  { key: 'submitted', label: 'Submitted' },
  { key: 'clarification_requested', label: 'Clarification requested' },
  { key: 'approved', label: 'Approved' },
  { key: 'declined', label: 'Declined' },
  { key: 'revoked', label: 'Revoked' },
];

const STATUS_LABEL: Record<AdviserApplicationStatus, string> = {
  submitted: 'Submitted',
  clarification_requested: 'Clarification requested',
  approved: 'Approved',
  declined: 'Declined',
  revoked: 'Revoked',
  withdrawn: 'Withdrawn',
};

const STATUS_STAMP: Record<AdviserApplicationStatus, StampKind> = {
  submitted: 'pending',
  clarification_requested: 'escalated',
  approved: 'verified',
  declined: 'rejected',
  revoked: 'rejected',
  withdrawn: 'neutral',
};

const DECISION: Record<
  AdviserDecision,
  {
    button: string;
    title: string;
    consequence: string;
    reasonLabel: string;
    destructive: boolean;
  }
> = {
  request_clarification: {
    button: 'Request clarification',
    title: 'Ask the applicant a question?',
    consequence:
      'The applicant sees your question on their Offer advice page and can answer it; the application then returns to Submitted.',
    reasonLabel: 'Your question to the applicant',
    destructive: false,
  },
  approve: {
    button: 'Approve',
    title: 'Approve this adviser?',
    consequence:
      'Their advice profile shows "Approved adviser" in the directory. Nothing else about the account changes.',
    reasonLabel: 'Reason for approving',
    destructive: false,
  },
  decline: {
    button: 'Decline',
    title: 'Decline this application?',
    consequence:
      'The applicant sees the decision and your reason, and may apply again later. Their advice profile, buying and selling are unaffected.',
    reasonLabel: 'Reason for declining',
    destructive: true,
  },
  revoke: {
    button: 'Revoke approval',
    title: 'Revoke this approval?',
    consequence:
      'The "Approved adviser" badge leaves their profile at once. Restoring a suspended account does not bring it back; only a new approved application does.',
    reasonLabel: 'Reason for revoking',
    destructive: true,
  },
};

interface Failure {
  status: number;
  message: string;
  fields: Record<string, string>;
}

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(path, init);
  } catch {
    throw { status: 0, message: 'The server could not be reached. Check the connection.', fields: {} };
  }
  const body = (await res.json().catch(() => ({}))) as {
    data?: T;
    error?: { message?: string; fields?: Record<string, string> };
  };
  if (!res.ok || body.data === undefined) {
    throw {
      status: res.status,
      message: body.error?.message ?? `The request failed (${res.status}).`,
      fields: body.error?.fields ?? {},
    } satisfies Failure;
  }
  return body.data;
}

export function AdviserReview() {
  const { role, hydrated } = usePreview();
  const isAdmin = hydrated && role === 'admin';
  const [tab, setTab] = useState<Tab>('submitted');
  const [rows, setRows] = useState<AdviserApplicationStaff[] | null>(null);
  const [failure, setFailure] = useState<Failure | null>(null);
  const [done, setDone] = useState<string | null>(null);

  const load = useCallback(() => {
    setRows(null);
    call<AdviserApplicationStaff[]>(`/api/admin/advisers?status=${tab}&limit=100`)
      .then((data) => {
        setRows(data);
        setFailure(null);
      })
      .catch((e: unknown) => {
        setRows([]);
        setFailure(e as Failure);
      });
  }, [tab]);

  useEffect(() => {
    if (isAdmin) load();
  }, [isAdmin, load]);

  if (!isAdmin || failure?.status === 403) {
    return (
      <Notice kind="info" title="Moderators only">
        <p className="small">
          Adviser applications are reviewed by administrators who hold Moderate content and
          listings.
        </p>
      </Notice>
    );
  }

  return (
    <section style={{ display: 'grid', gap: 'var(--s-3)' }}>
      <h2>Approved advisers</h2>
      <p className="small muted">
        An optional pathway: an advice provider asks CORWADO to review their experience and
        qualifications. Approval adds an &quot;Approved adviser&quot; badge to their advice
        profile. It never changes ordinary access, and it is separate from account suspension.
      </p>
      <Tabs
        label="Application status"
        items={TABS}
        value={tab}
        onChange={(k) => {
          setDone(null);
          setTab(k);
        }}
      />
      {failure ? (
        <Notice kind="error">
          <p className="small">{failure.message}</p>
        </Notice>
      ) : null}
      {done ? <Notice kind="success">{done}</Notice> : null}
      {rows === null ? (
        <p className="muted">Loading…</p>
      ) : rows.length === 0 ? (
        <Notice kind="info" title="Nothing here">
          <p className="small">No application has this status.</p>
        </Notice>
      ) : (
        <ul style={{ listStyle: 'none', padding: 0, display: 'grid', gap: 12 }}>
          {rows.map((a) => (
            <li key={a.id}>
              <ApplicationCard
                application={a}
                onDecided={(message) => {
                  setDone(message);
                  load();
                }}
              />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function ApplicationCard({
  application: a,
  onDecided,
}: {
  application: AdviserApplicationStaff;
  onDecided: (message: string) => void;
}) {
  const [action, setAction] = useState<AdviserDecision | null>(null);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<Failure | null>(null);

  const allowed = (Object.keys(ADVISER_DECISION_RULES) as AdviserDecision[]).filter((d) =>
    (ADVISER_DECISION_RULES[d].from as readonly string[]).includes(a.status),
  );

  const decide = async () => {
    if (!action) return;
    const trimmed = reason.trim();
    if (trimmed.length < ADVISER_LIMITS.reasonMin) {
      setFailure({
        status: 400,
        message: 'Check the reason.',
        fields: { reason: 'Give a reason of 5 to 1000 characters.' },
      });
      return;
    }
    setBusy(true);
    setFailure(null);
    try {
      await call<AdviserApplicationStaff>(
        `/api/admin/advisers/${encodeURIComponent(a.id)}/decision`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ action, reason: trimmed }),
        },
      );
      const what = DECISION[action].button;
      setAction(null);
      setReason('');
      onDecided(`${what}: saved for ${a.provider.display_name}.`);
    } catch (e) {
      setFailure(e as Failure);
    } finally {
      setBusy(false);
    }
  };

  const side = [a.account.farmer ? 'farmer' : null, a.account.buyer ? 'buyer' : null]
    .filter(Boolean)
    .join(' and ');

  return (
    <Card padded>
      <div style={{ display: 'grid', gap: 'var(--s-2)' }}>
        <p>
          <strong dir="auto">{a.provider.display_name}</strong>{' '}
          <span className="small muted">
            · {t(KIND_KEY[a.provider.provider_kind as keyof typeof KIND_KEY] ?? 'advice.kind.other')}{' '}
            · {side ? `${side} account` : 'account removed'} · profile {a.provider.status}
          </span>
        </p>
        <p className="small">
          <Stamp kind={STATUS_STAMP[a.status]}>{STATUS_LABEL[a.status]}</Stamp> · sent{' '}
          {formatDate(a.created_at)} · last change {formatDate(a.updated_at)}
          {a.account.suspended ? (
            <>
              {' '}
              · <Stamp kind="rejected">Account suspended</Stamp>
            </>
          ) : null}
        </p>
        <dl style={{ display: 'grid', gap: 'var(--s-2)', margin: 0 }}>
          <Fact label="Specialties">
            {a.specialties.map((v) => t(TOPIC_KEY[v])).join(' · ')}
          </Fact>
          <Fact label="Service area">
            {a.service_area.length ? a.service_area.join(', ') : 'Anywhere'}
          </Fact>
          <Fact label="Languages">{a.languages.map((v) => t(LANGUAGE_KEY[v])).join(', ')}</Fact>
          <Fact label="Experience">{a.experience}</Fact>
          <Fact label="Qualifications">{a.qualifications ?? 'None given'}</Fact>
          <Fact label="Affiliation">{a.affiliation ?? 'None given'}</Fact>
          <Fact label="Commercial interests (profile)">
            {a.provider.commercial_interests ?? 'None declared'}
          </Fact>
          <Fact label="About (profile)">{a.provider.description}</Fact>
          {a.clarification_request ? (
            <Fact label="Question asked">{a.clarification_request}</Fact>
          ) : null}
          {a.applicant_reply ? <Fact label="Applicant's answer">{a.applicant_reply}</Fact> : null}
          {a.decision_reason ? (
            <Fact label="Recorded reason">
              {a.decision_reason}
              {a.decided_at ? ` · ${formatDate(a.decided_at)}` : ''}
              {a.decided_by_name ? ` · ${a.decided_by_name}` : ''}
            </Fact>
          ) : null}
        </dl>
        {allowed.length > 0 ? (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            {allowed.map((d) => (
              <Button
                key={d}
                size="small"
                variant={DECISION[d].destructive ? 'danger' : d === 'approve' ? 'primary' : 'secondary'}
                onClick={() => {
                  setReason('');
                  setFailure(null);
                  setAction(d);
                }}
              >
                {DECISION[d].button}
              </Button>
            ))}
          </div>
        ) : null}
      </div>
      {action ? (
        <ConfirmationDialog
          open
          onCancel={() => setAction(null)}
          onConfirm={() => void decide()}
          title={DECISION[action].title}
          consequence={DECISION[action].consequence}
          confirmLabel={DECISION[action].button}
          destructive={DECISION[action].destructive}
          busy={busy}
        >
          {failure && !failure.fields.reason ? (
            <Notice kind="error">{failure.message}</Notice>
          ) : null}
          <Field
            label={DECISION[action].reasonLabel}
            hint="5 to 1000 characters. Kept with the application and in the audit trail."
            error={failure?.fields.reason}
          >
            {(ids) => (
              <Textarea
                {...ids}
                rows={3}
                maxLength={ADVISER_LIMITS.reasonMax}
                value={reason}
                onChange={(e) => setReason(e.target.value)}
              />
            )}
          </Field>
        </ConfirmationDialog>
      ) : null}
    </Card>
  );
}

function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <dt className="small muted">{label}</dt>
      <dd dir="auto" style={{ margin: 0, whiteSpace: 'pre-wrap' }}>
        {children}
      </dd>
    </div>
  );
}
