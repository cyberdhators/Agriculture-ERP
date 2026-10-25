'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';

import {
  ORG_ADVICE_OUTCOMES,
  orgAdviceActionSchema,
  sendMessageSchema,
  type AdviceCaseStatus,
  type AdviceOutcome,
  type AdviceProviderOwn,
  type OrgAdviceActionInput,
  type OrgAdviceCaseView,
  type OrgAdviceHandler,
} from '@agri-erp/shared';

import { ProviderForm } from '@/components/advice/ProviderForm';
import { Badge, Button, Field, Notice, Select, Tabs, Textarea } from '@/components/ui';
import { AdviceError } from '@/lib/advice/client';
import { FARMER_ADVICE, BUYER_ADVICE, topicLabel } from '@/lib/advice/labels';
import { type Language } from '@/lib/i18n';

import { errorText, sendJson, teamBase } from './words';

/**
 * AN ORGANISATION'S ADVICE (2026-10-28): its shared advice inbox and its
 * advice profile. CORWADO's infographic 8, panel 3: "Requests go directly to
 * the provider's authorized staff, who manage the conversation." Mobile first:
 * one column, buttons that wrap.
 *
 * The inbox is for members holding "Handle advisory cases"; the server
 * refuses everyone else, and this page says so plainly. Each request shows
 * who is handling it; the buttons are the ones the server would allow
 * (`may`), and the server decides again on every press.
 */

type Tab = 'inbox' | 'profile';

interface Detail {
  case: OrgAdviceCaseView;
  shared: { place: string | null; phone: string | null } | null;
  blocked: boolean;
  messages: {
    id: string;
    body: string;
    from_me: boolean;
    created_at: string;
    sent_by?: string | null;
  }[];
}

const STATUS_WORDS: Record<AdviceCaseStatus, string> = {
  open: 'New',
  in_progress: 'In progress',
  closed: 'Closed',
};

const OUTCOME_WORDS: Record<AdviceOutcome, string> = {
  resolved: 'Resolved',
  referred: 'Referred elsewhere',
  closed_unresolved: 'Closed unresolved',
  cancelled: 'Cancelled',
};

const col: React.CSSProperties = { display: 'flex', flexDirection: 'column', gap: 12 };
const row: React.CSSProperties = {
  display: 'flex',
  flexWrap: 'wrap',
  gap: 8,
  alignItems: 'center',
};
const box: React.CSSProperties = {
  border: '1px solid var(--color-border, #d9d9d9)',
  borderRadius: 8,
  padding: 12,
  ...col,
};

const when = (iso: string) =>
  new Date(iso).toLocaleString('en-GB', {
    timeZone: 'Africa/Juba',
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });

const newId = () =>
  typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : '10000000-1000-4000-8000-100000000000'.replace(/[018]/g, (c) =>
        (Number(c) ^ (Math.random() * 16)).toString(16),
      );

async function readData<T>(response: Response): Promise<T> {
  return ((await response.json()) as { data: T }).data;
}

export function OrganisationAdvice({
  id,
  side,
  language = 'en',
}: {
  id: string;
  side: 'farmer' | 'buyer';
  language?: Language;
}) {
  const [tab, setTab] = useState<Tab>('inbox');
  const base = `/api/organizations/${id}`;
  const back = `${teamBase(side)}/${id}`;
  const find = side === 'farmer' ? FARMER_ADVICE.find : BUYER_ADVICE.find;

  return (
    <div style={{ ...col, gap: 20, maxWidth: 760 }}>
      <Link href={back} className="small">
        ← Back to the organisation
      </Link>
      <header>
        <h1 style={{ margin: 0 }}>Advice requests</h1>
        <p className="small muted" style={{ margin: 0 }}>
          Questions people asked your organisation&apos;s advice profile. Only members who handle
          advisory cases can see them. Your personal messages stay separate.
        </p>
      </header>
      <Tabs
        label="Organisation advice"
        items={[
          { key: 'inbox', label: 'Shared inbox' },
          { key: 'profile', label: 'Advice profile' },
        ]}
        value={tab}
        onChange={setTab}
      />
      {tab === 'inbox' ? (
        <Inbox base={base} language={language} />
      ) : (
        <ProviderForm
          lang={language}
          base={find}
          workHref={back}
          source={{
            title: "Your organisation's advice profile",
            lead: 'Requests to this profile come to the shared inbox. Publishing needs no approval from CORWADO; it is not an endorsement.',
            load: async () => {
              const response = await fetch(`${base}/advice-provider`, { cache: 'no-store' });
              if (!response.ok) {
                throw new AdviceError(
                  response.status,
                  'refused',
                  await errorText(response, 'The profile could not be loaded.'),
                );
              }
              return (await readData<{ profile: AdviceProviderOwn | null }>(response)).profile;
            },
            save: async (body) => {
              const response = await fetch(`${base}/advice-provider`, {
                method: 'PUT',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify(body),
              });
              if (!response.ok) {
                const failure = (await response.json().catch(() => ({}))) as {
                  error?: { code?: string; message?: string; fields?: Record<string, string> };
                };
                throw new AdviceError(
                  response.status,
                  failure.error?.code ?? 'unknown',
                  failure.error?.message ?? 'The profile could not be saved.',
                  failure.error?.fields ?? {},
                );
              }
              return readData<AdviceProviderOwn>(response);
            },
          }}
        />
      )}
    </div>
  );
}

function Inbox({ base, language }: { base: string; language: Language }) {
  const [status, setStatus] = useState<AdviceCaseStatus>('open');
  const [cases, setCases] = useState<OrgAdviceCaseView[] | null>(null);
  const [handlers, setHandlers] = useState<OrgAdviceHandler[]>([]);
  const [refused, setRefused] = useState<string | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  const load = useCallback(async () => {
    const response = await fetch(`${base}/advice-cases?status=${status}`, {
      cache: 'no-store',
    }).catch(() => null);
    if (!response) {
      setRefused('The server could not be reached. Check the connection.');
      return;
    }
    if (response.status === 403) {
      setRefused(
        'You need the "Handle advisory cases" permission to see these requests. Ask an administrator of the organisation.',
      );
      return;
    }
    if (!response.ok) {
      setRefused(await errorText(response, 'The requests could not be loaded.'));
      return;
    }
    setRefused(null);
    setCases(await readData<OrgAdviceCaseView[]>(response));
    const team = await fetch(`${base}/advice-cases/handlers`, { cache: 'no-store' }).catch(
      () => null,
    );
    if (team?.ok) setHandlers(await readData<OrgAdviceHandler[]>(team));
  }, [base, status]);

  useEffect(() => {
    setCases(null);
    void load();
  }, [load]);

  async function act(caseId: string, input: OrgAdviceActionInput) {
    const check = orgAdviceActionSchema.safeParse(input);
    if (!check.success) {
      setMessage({ ok: false, text: check.error.issues[0]?.message ?? 'Check the form.' });
      return;
    }
    const response = await sendJson(
      `${base}/advice-cases/${caseId}/action`,
      'POST',
      check.data,
    ).catch(() => null);
    if (!response?.ok) {
      setMessage({
        ok: false,
        text: response
          ? await errorText(response, 'That change was not made.')
          : 'The server could not be reached.',
      });
      return;
    }
    setMessage({ ok: true, text: 'Done.' });
    await load();
  }

  if (refused) {
    return (
      <Notice kind="warn">
        <p className="small">{refused}</p>
      </Notice>
    );
  }

  return (
    <div style={col}>
      <Tabs
        label="Request status"
        items={(['open', 'in_progress', 'closed'] as const).map((key) => ({
          key,
          label: STATUS_WORDS[key],
        }))}
        value={status}
        onChange={(next) => {
          setStatus(next);
          setOpenId(null);
        }}
      />
      {message ? (
        <Notice kind={message.ok ? 'success' : 'error'}>
          <p className="small">{message.text}</p>
        </Notice>
      ) : null}
      {cases === null ? <p className="small muted">…</p> : null}
      {cases && cases.length === 0 ? <p className="small muted">No requests here.</p> : null}
      {cases?.map((c) => (
        <div key={c.id} style={box}>
          <div style={{ ...row, justifyContent: 'space-between' }}>
            <strong>{topicLabel(c.topic, language)}</strong>
            <span style={row}>
              {c.unread ? <Badge tone="sorghum">New message</Badge> : null}
              <Badge tone={c.status === 'closed' ? 'neutral' : 'leaf'}>
                {STATUS_WORDS[c.status]}
              </Badge>
            </span>
          </div>
          <p className="small muted" style={{ margin: 0 }}>
            From {c.requester_name} · {when(c.created_at)}
            {c.outcome ? ` · ${OUTCOME_WORDS[c.outcome]}` : ''}
          </p>
          <p className="small" style={{ margin: 0 }}>
            {c.assigned_to
              ? `Handled by ${c.assigned_to.is_me ? 'you' : c.assigned_to.name}${
                  c.accepted ? '' : ' (not accepted yet)'
                }`
              : 'Nobody is handling this yet.'}
          </p>
          <div style={row}>
            {c.may.claim ? (
              <Button onClick={() => void act(c.id, { action: 'claim' })}>Take it</Button>
            ) : null}
            {c.may.accept ? (
              <Button onClick={() => void act(c.id, { action: 'accept' })}>Accept</Button>
            ) : null}
            {c.may.release ? (
              <Button variant="secondary" onClick={() => void act(c.id, { action: 'release' })}>
                Give it back
              </Button>
            ) : null}
            <Button variant="ghost" onClick={() => setOpenId(openId === c.id ? null : c.id)}>
              {openId === c.id ? 'Hide' : 'Open'}
            </Button>
          </div>
          {c.may.assign ? (
            <AssignTo
              handlers={handlers}
              current={c.assigned_to?.member_id ?? null}
              onAssign={(memberId) => void act(c.id, { action: 'assign', member_id: memberId })}
            />
          ) : null}
          {openId === c.id ? (
            <CaseThread
              base={base}
              caseId={c.id}
              onChanged={() => void load()}
              onClose={(outcome) => void act(c.id, { action: 'close', outcome })}
            />
          ) : null}
        </div>
      ))}
    </div>
  );
}

function AssignTo({
  handlers,
  current,
  onAssign,
}: {
  handlers: OrgAdviceHandler[];
  current: string | null;
  onAssign: (memberId: string) => void;
}) {
  const [choice, setChoice] = useState(current ?? '');
  return (
    <div style={row}>
      <Field label="Give this request to">
        {(ids) => (
          <Select {...ids} value={choice} onChange={(e) => setChoice(e.target.value)}>
            <option value="">Choose a member</option>
            {handlers.map((h) => (
              <option key={h.member_id} value={h.member_id}>
                {h.is_me ? `${h.name} (you)` : h.name}
              </option>
            ))}
          </Select>
        )}
      </Field>
      <Button
        variant="secondary"
        disabled={!choice || choice === current}
        onClick={() => onAssign(choice)}
      >
        Assign
      </Button>
    </div>
  );
}

function CaseThread({
  base,
  caseId,
  onChanged,
  onClose,
}: {
  base: string;
  caseId: string;
  onChanged: () => void;
  onClose: (outcome: AdviceOutcome) => void;
}) {
  const [detail, setDetail] = useState<Detail | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const [text, setText] = useState('');
  const [outcome, setOutcome] = useState<AdviceOutcome | ''>('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const response = await fetch(`${base}/advice-cases/${caseId}`, { cache: 'no-store' }).catch(
      () => null,
    );
    if (!response?.ok) {
      setFailure(
        response ? await errorText(response, 'This request could not be opened.') : 'Offline.',
      );
      return;
    }
    setDetail(await readData<Detail>(response));
  }, [base, caseId]);

  useEffect(() => {
    void load();
  }, [load]);

  async function reply() {
    const check = sendMessageSchema.safeParse({ id: newId(), body: text });
    if (!check.success) {
      setFailure(check.error.issues[0]?.message ?? 'Write a message first.');
      return;
    }
    setBusy(true);
    const response = await sendJson(
      `${base}/advice-cases/${caseId}/messages`,
      'POST',
      check.data,
    ).catch(() => null);
    setBusy(false);
    if (!response?.ok) {
      setFailure(
        response ? await errorText(response, 'The message was not sent.') : 'Not sent: offline.',
      );
      return;
    }
    setText('');
    setFailure(null);
    await load();
    onChanged();
  }

  if (failure && !detail) {
    return (
      <Notice kind="error">
        <p className="small">{failure}</p>
      </Notice>
    );
  }
  if (!detail) return <p className="small muted">…</p>;
  const c = detail.case;

  return (
    <div style={col}>
      <p style={{ margin: 0, whiteSpace: 'pre-wrap' }} dir="auto">
        {c.question}
      </p>
      {detail.shared ? (
        <p className="small muted" style={{ margin: 0 }}>
          Shared by the person asking:{' '}
          {[detail.shared.place, detail.shared.phone].filter(Boolean).join(' · ') || 'nothing'}
        </p>
      ) : null}
      <div style={col} aria-label="Conversation">
        {detail.messages.map((m) => (
          <div
            key={m.id}
            style={{
              alignSelf: m.from_me ? 'flex-end' : 'flex-start',
              maxWidth: '85%',
              background: m.from_me
                ? 'var(--color-leaf-50, #eef6ee)'
                : 'var(--color-paper, #f6f4ef)',
              borderRadius: 8,
              padding: 8,
            }}
          >
            <p style={{ margin: 0, whiteSpace: 'pre-wrap' }} dir="auto">
              {m.body}
            </p>
            <p className="small muted" style={{ margin: 0 }}>
              {m.from_me ? (m.sent_by ? `${m.sent_by} · ` : 'You · ') : ''}
              {when(m.created_at)}
            </p>
          </div>
        ))}
      </div>
      {failure ? (
        <Notice kind="error">
          <p className="small">{failure}</p>
        </Notice>
      ) : null}
      {c.may.reply && !detail.blocked ? (
        <div style={col}>
          <Field label="Reply for the organisation" hint="Ask a question, answer, or follow up.">
            {(ids) => (
              <Textarea {...ids} rows={3} value={text} onChange={(e) => setText(e.target.value)} />
            )}
          </Field>
          <div style={row}>
            <Button disabled={busy || text.trim() === ''} onClick={() => void reply()}>
              Send
            </Button>
          </div>
        </div>
      ) : c.status !== 'closed' ? (
        <p className="small muted">
          {c.assigned_to?.is_me
            ? 'Accept this request to reply.'
            : 'Only the member handling this request replies to it.'}
        </p>
      ) : null}
      {c.may.close ? (
        <div style={row}>
          <Field label="Close with outcome">
            {(ids) => (
              <Select
                {...ids}
                value={outcome}
                onChange={(e) => setOutcome(e.target.value as AdviceOutcome | '')}
              >
                <option value="">Choose</option>
                {ORG_ADVICE_OUTCOMES.map((o) => (
                  <option key={o} value={o}>
                    {OUTCOME_WORDS[o]}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <Button
            variant="secondary"
            disabled={!outcome}
            onClick={() => outcome && onClose(outcome)}
          >
            Close request
          </Button>
        </div>
      ) : null}
      <p className="small muted" style={{ margin: 0 }}>
        Advice is not a guarantee of results. Keep the requester&apos;s details private.
      </p>
    </div>
  );
}
