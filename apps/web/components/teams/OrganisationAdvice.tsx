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

/**
 * 2026-10-29: the page's words in English and Arabic, as the other team
 * pages keep theirs (ShortcutHub, StateField). Messages the server sends
 * back (errorText) stay as the server wrote them.
 */
const EN = {
  status: { open: 'New', in_progress: 'In progress', closed: 'Closed' } as Record<
    AdviceCaseStatus,
    string
  >,
  outcome: {
    resolved: 'Resolved',
    referred: 'Referred elsewhere',
    closed_unresolved: 'Closed unresolved',
    cancelled: 'Cancelled',
  } as Record<AdviceOutcome, string>,
  back: '← Back to the organisation',
  title: 'Advice requests',
  lead: "Questions people asked your organisation's advice profile. Only members who handle advisory cases can see them. Your personal messages stay separate.",
  tabsLabel: 'Organisation advice',
  inbox: 'Shared inbox',
  profile: 'Advice profile',
  profileTitle: "Your organisation's advice profile",
  profileLead:
    'Requests to this profile come to the shared inbox. Publishing needs no approval from CORWADO; it is not an endorsement.',
  profileNotLoaded: 'The profile could not be loaded.',
  profileNotSaved: 'The profile could not be saved.',
  unreachable: 'The server could not be reached. Check the connection.',
  noPermission:
    'You need the "Handle advisory cases" permission to see these requests. Ask an administrator of the organisation.',
  notLoaded: 'The requests could not be loaded.',
  checkForm: 'Check the form.',
  notMade: 'That change was not made.',
  unreachableShort: 'The server could not be reached.',
  done: 'Done.',
  statusLabel: 'Request status',
  none: 'No requests here.',
  newMessage: 'New message',
  from: 'From',
  handledBy: 'Handled by',
  you: 'you',
  notAccepted: ' (not accepted yet)',
  nobody: 'Nobody is handling this yet.',
  claim: 'Take it',
  accept: 'Accept',
  release: 'Give it back',
  hide: 'Hide',
  open: 'Open',
  assignLabel: 'Give this request to',
  chooseMember: 'Choose a member',
  youMark: '(you)',
  assign: 'Assign',
  notOpened: 'This request could not be opened.',
  offline: 'Offline.',
  writeFirst: 'Write a message first.',
  notSent: 'The message was not sent.',
  notSentOffline: 'Not sent: offline.',
  sharedBy: 'Shared by the person asking:',
  nothing: 'nothing',
  conversation: 'Conversation',
  youDot: 'You · ',
  replyLabel: 'Reply for the organisation',
  replyHint: 'Ask a question, answer, or follow up.',
  send: 'Send',
  acceptToReply: 'Accept this request to reply.',
  onlyHandler: 'Only the member handling this request replies to it.',
  closeLabel: 'Close with outcome',
  choose: 'Choose',
  closeRequest: 'Close request',
  footer: "Advice is not a guarantee of results. Keep the requester's details private.",
};

type Words = typeof EN;

const AR: Words = {
  status: { open: 'جديد', in_progress: 'قيد المتابعة', closed: 'مغلق' },
  outcome: {
    resolved: 'تم الحل',
    referred: 'أُحيل إلى جهة أخرى',
    closed_unresolved: 'أُغلق دون حل',
    cancelled: 'أُلغي',
  },
  back: '→ العودة إلى المنظمة',
  title: 'طلبات النصيحة',
  lead: 'أسئلة طرحها الناس على ملف النصيحة الخاص بمنظمتك. لا يراها إلا الأعضاء الذين يتولون حالات النصيحة. رسائلك الشخصية تبقى منفصلة.',
  tabsLabel: 'نصيحة المنظمة',
  inbox: 'البريد المشترك',
  profile: 'ملف النصيحة',
  profileTitle: 'ملف النصيحة الخاص بمنظمتك',
  profileLead:
    'تصل الطلبات الموجهة إلى هذا الملف إلى البريد المشترك. لا يحتاج النشر إلى موافقة CORWADO، وليس تزكية منها.',
  profileNotLoaded: 'تعذر تحميل الملف.',
  profileNotSaved: 'تعذر حفظ الملف.',
  unreachable: 'تعذر الوصول إلى الخادم. تحقق من الاتصال.',
  noPermission:
    'تحتاج إلى صلاحية «تولي حالات النصيحة» لرؤية هذه الطلبات. اطلبها من أحد مديري المنظمة.',
  notLoaded: 'تعذر تحميل الطلبات.',
  checkForm: 'تحقق من النموذج.',
  notMade: 'لم يتم هذا التغيير.',
  unreachableShort: 'تعذر الوصول إلى الخادم.',
  done: 'تم.',
  statusLabel: 'حالة الطلب',
  none: 'لا توجد طلبات هنا.',
  newMessage: 'رسالة جديدة',
  from: 'من',
  handledBy: 'يتولاه',
  you: 'أنت',
  notAccepted: ' (لم يُقبل بعد)',
  nobody: 'لا أحد يتولى هذا الطلب بعد.',
  claim: 'تولَّه',
  accept: 'قبول',
  release: 'أعِده',
  hide: 'إخفاء',
  open: 'فتح',
  assignLabel: 'أسند هذا الطلب إلى',
  chooseMember: 'اختر عضواً',
  youMark: '(أنت)',
  assign: 'إسناد',
  notOpened: 'تعذر فتح هذا الطلب.',
  offline: 'لا يوجد اتصال.',
  writeFirst: 'اكتب رسالة أولاً.',
  notSent: 'لم تُرسل الرسالة.',
  notSentOffline: 'لم تُرسل: لا يوجد اتصال.',
  sharedBy: 'ما شاركه صاحب الطلب:',
  nothing: 'لا شيء',
  conversation: 'المحادثة',
  youDot: 'أنت · ',
  replyLabel: 'الرد باسم المنظمة',
  replyHint: 'اطرح سؤالاً، أو أجب، أو تابع.',
  send: 'إرسال',
  acceptToReply: 'اقبل هذا الطلب لتتمكن من الرد.',
  onlyHandler: 'لا يرد على هذا الطلب إلا العضو الذي يتولاه.',
  closeLabel: 'الإغلاق مع النتيجة',
  choose: 'اختر',
  closeRequest: 'إغلاق الطلب',
  footer: 'النصيحة ليست ضماناً للنتائج. حافظ على سرية بيانات صاحب الطلب.',
};

const wordsFor = (language: Language): Words => (language === 'ar' ? AR : EN);

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
  const w = wordsFor(language);

  return (
    <div style={{ ...col, gap: 20, maxWidth: 760 }}>
      <Link href={back} className="small">
        {w.back}
      </Link>
      <header>
        <h1 style={{ margin: 0 }}>{w.title}</h1>
        <p className="small muted" style={{ margin: 0 }}>
          {w.lead}
        </p>
      </header>
      <Tabs
        label={w.tabsLabel}
        items={[
          { key: 'inbox', label: w.inbox },
          { key: 'profile', label: w.profile },
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
            title: w.profileTitle,
            lead: w.profileLead,
            load: async () => {
              const response = await fetch(`${base}/advice-provider`, { cache: 'no-store' });
              if (!response.ok) {
                throw new AdviceError(
                  response.status,
                  'refused',
                  await errorText(response, w.profileNotLoaded),
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
                  failure.error?.message ?? w.profileNotSaved,
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
  const w = wordsFor(language);
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
      setRefused(w.unreachable);
      return;
    }
    if (response.status === 403) {
      setRefused(w.noPermission);
      return;
    }
    if (!response.ok) {
      setRefused(await errorText(response, w.notLoaded));
      return;
    }
    setRefused(null);
    setCases(await readData<OrgAdviceCaseView[]>(response));
    const team = await fetch(`${base}/advice-cases/handlers`, { cache: 'no-store' }).catch(
      () => null,
    );
    if (team?.ok) setHandlers(await readData<OrgAdviceHandler[]>(team));
  }, [base, status, w]);

  useEffect(() => {
    setCases(null);
    void load();
  }, [load]);

  async function act(caseId: string, input: OrgAdviceActionInput) {
    const check = orgAdviceActionSchema.safeParse(input);
    if (!check.success) {
      setMessage({ ok: false, text: check.error.issues[0]?.message ?? w.checkForm });
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
          ? await errorText(response, w.notMade)
          : w.unreachableShort,
      });
      return;
    }
    setMessage({ ok: true, text: w.done });
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
        label={w.statusLabel}
        items={(['open', 'in_progress', 'closed'] as const).map((key) => ({
          key,
          label: w.status[key],
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
      {cases && cases.length === 0 ? <p className="small muted">{w.none}</p> : null}
      {cases?.map((c) => (
        <div key={c.id} style={box}>
          <div style={{ ...row, justifyContent: 'space-between' }}>
            <strong>{topicLabel(c.topic, language)}</strong>
            <span style={row}>
              {c.unread ? <Badge tone="sorghum">{w.newMessage}</Badge> : null}
              <Badge tone={c.status === 'closed' ? 'neutral' : 'leaf'}>
                {w.status[c.status]}
              </Badge>
            </span>
          </div>
          <p className="small muted" style={{ margin: 0 }}>
            {w.from} <span dir="auto">{c.requester_name}</span> · {when(c.created_at)}
            {c.outcome ? ` · ${w.outcome[c.outcome]}` : ''}
          </p>
          <p className="small" style={{ margin: 0 }}>
            {c.assigned_to
              ? `${w.handledBy} ${c.assigned_to.is_me ? w.you : c.assigned_to.name}${
                  c.accepted ? '' : w.notAccepted
                }`
              : w.nobody}
          </p>
          <div style={row}>
            {c.may.claim ? (
              <Button onClick={() => void act(c.id, { action: 'claim' })}>{w.claim}</Button>
            ) : null}
            {c.may.accept ? (
              <Button onClick={() => void act(c.id, { action: 'accept' })}>{w.accept}</Button>
            ) : null}
            {c.may.release ? (
              <Button variant="secondary" onClick={() => void act(c.id, { action: 'release' })}>
                {w.release}
              </Button>
            ) : null}
            <Button variant="ghost" onClick={() => setOpenId(openId === c.id ? null : c.id)}>
              {openId === c.id ? w.hide : w.open}
            </Button>
          </div>
          {c.may.assign ? (
            <AssignTo
              w={w}
              handlers={handlers}
              current={c.assigned_to?.member_id ?? null}
              onAssign={(memberId) => void act(c.id, { action: 'assign', member_id: memberId })}
            />
          ) : null}
          {openId === c.id ? (
            <CaseThread
              w={w}
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
  w,
  handlers,
  current,
  onAssign,
}: {
  w: Words;
  handlers: OrgAdviceHandler[];
  current: string | null;
  onAssign: (memberId: string) => void;
}) {
  const [choice, setChoice] = useState(current ?? '');
  return (
    <div style={row}>
      <Field label={w.assignLabel}>
        {(ids) => (
          <Select {...ids} value={choice} onChange={(e) => setChoice(e.target.value)}>
            <option value="">{w.chooseMember}</option>
            {handlers.map((h) => (
              <option key={h.member_id} value={h.member_id}>
                {h.is_me ? `${h.name} ${w.youMark}` : h.name}
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
        {w.assign}
      </Button>
    </div>
  );
}

function CaseThread({
  w,
  base,
  caseId,
  onChanged,
  onClose,
}: {
  w: Words;
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
        response ? await errorText(response, w.notOpened) : w.offline,
      );
      return;
    }
    setDetail(await readData<Detail>(response));
  }, [base, caseId, w]);

  useEffect(() => {
    void load();
  }, [load]);

  async function reply() {
    const check = sendMessageSchema.safeParse({ id: newId(), body: text });
    if (!check.success) {
      setFailure(check.error.issues[0]?.message ?? w.writeFirst);
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
        response ? await errorText(response, w.notSent) : w.notSentOffline,
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
          {w.sharedBy}{' '}
          {[detail.shared.place, detail.shared.phone].filter(Boolean).join(' · ') || w.nothing}
        </p>
      ) : null}
      <div style={col} aria-label={w.conversation}>
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
              {m.from_me ? (m.sent_by ? `${m.sent_by} · ` : w.youDot) : ''}
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
          <Field label={w.replyLabel} hint={w.replyHint}>
            {(ids) => (
              <Textarea {...ids} rows={3} value={text} onChange={(e) => setText(e.target.value)} />
            )}
          </Field>
          <div style={row}>
            <Button disabled={busy || text.trim() === ''} onClick={() => void reply()}>
              {w.send}
            </Button>
          </div>
        </div>
      ) : c.status !== 'closed' ? (
        <p className="small muted">
          {c.assigned_to?.is_me
            ? w.acceptToReply
            : w.onlyHandler}
        </p>
      ) : null}
      {c.may.close ? (
        <div style={row}>
          <Field label={w.closeLabel}>
            {(ids) => (
              <Select
                {...ids}
                value={outcome}
                onChange={(e) => setOutcome(e.target.value as AdviceOutcome | '')}
              >
                <option value="">{w.choose}</option>
                {ORG_ADVICE_OUTCOMES.map((o) => (
                  <option key={o} value={o}>
                    {w.outcome[o]}
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
            {w.closeRequest}
          </Button>
        </div>
      ) : null}
      <p className="small muted" style={{ margin: 0 }}>
        {w.footer}
      </p>
    </div>
  );
}
