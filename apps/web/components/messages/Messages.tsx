'use client';

import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';

import {
  MESSAGE_MAX_LENGTH,
  MESSAGE_POLL_MS,
  type ChatMessage,
  type ConversationKind,
  type ConversationSummary,
} from '@agri-erp/shared';

import { PresenceLine } from '@/components/live/Presence';
import { MyRatingsPanel } from '@/components/ratings/Ratings';
import { Button, EmptyState, Notice, Skeleton, Tabs } from '@/components/ui';
import { caseHref, topicLabel } from '@/lib/advice/labels';
import { formatDate } from '@/lib/format';
import { t, type Language, type TKey } from '@/lib/i18n';
import { LIVE_EVENT, useLiveEvent, type LiveEvent } from '@/lib/realtime/client';
import {
  MessagesError,
  archiveConversation,
  blockPerson,
  listConversations,
  messagesChanged,
  openConversation,
  queueMessage,
  subscribeOutbox,
  waitingMessages,
} from '@/lib/messages/client';

import styles from './messages.module.css';

/**
 * IN-APP MESSAGING (2026-10-20). The inbox, and one conversation when the
 * address carries `?c=<id>`. Farmers (in their language) and buyers use the
 * same screen; conversations belong to the sign-in, so both see one inbox.
 *
 * An open conversation asks for new messages every few seconds while it is on
 * screen. A message written with no signal waits on the phone, marked, and
 * goes when signal returns.
 *
 * 2026-11-03 (lane-trust): three tabs, in the address as `?tab=`: Chats,
 * Archived ("Archive for me" -- only the reader's own list changes, and a new
 * message brings a chat back) and Ratings (deals to rate, ratings received).
 * "Close conversation" is gone; "Block this person" still stops contact.
 */

type InboxTab = 'chats' | 'archived' | 'ratings';
const INBOX_TABS: readonly InboxTab[] = ['chats', 'archived', 'ratings'];

const KIND_LABEL: Record<ConversationKind, TKey> = {
  listing: 'msg.aboutListing',
  buying_request: 'msg.aboutRequest',
  service: 'msg.aboutService',
  // 2026-10-22: the conversation under an advice request.
  advice_case: 'msg.aboutAdvice',
};

/**
 * Where the post itself is, for "about" links. An advice request's page is
 * in the person's own side of the app (2026-10-22).
 */
export function postHref(
  kind: ConversationKind,
  id: string,
  side: 'farmer' | 'buyer' = 'farmer',
): string {
  if (kind === 'listing') return `/market/${id}`;
  if (kind === 'buying_request') return `/market/requests/${id}`;
  if (kind === 'advice_case') return caseHref(side, id);
  return `/market/services/${id}`;
}

/** "Listing · Maize", or for an advice request its topic, in the reader's language. */
function aboutLine(c: ConversationSummary, language: Language): string {
  const title = c.post_kind === 'advice_case' ? topicLabel(c.post_title, language) : c.post_title;
  return `${t(KIND_LABEL[c.post_kind], language)} · ${title}`;
}

export function Messages({ language }: { language: Language }) {
  const params = useSearchParams();
  const open = params.get('c');
  const asked = params.get('tab') as InboxTab | null;
  const tab: InboxTab = asked && INBOX_TABS.includes(asked) ? asked : 'chats';
  return open ? (
    <Conversation key={open} id={open} language={language} />
  ) : (
    <Inbox key={tab} tab={tab} language={language} />
  );
}

function Inbox({ language, tab }: { language: Language; tab: InboxTab }) {
  const pathname = usePathname();
  const router = useRouter();
  const [rows, setRows] = useState<ConversationSummary[] | null>(null);
  const [offline, setOffline] = useState(false);

  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (tab === 'ratings') return;
    let cancelled = false;
    listConversations(tab === 'archived')
      .then((got) => {
        if (!cancelled) setRows(got);
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        setOffline(e instanceof MessagesError && e.status === 0);
        setRows((prev) => prev ?? []);
      });
    return () => {
      cancelled = true;
    };
  }, [tick, tab]);
  // 2026-10-26: a new message in any of these conversations re-reads the list
  // at once (lib/realtime); without live updates it reads on each visit, as before.
  useLiveEvent((e) => {
    if (e.event === 'message.created') setTick((n) => n + 1);
  });

  return (
    <div className={styles.page}>
      {/* 2026-10-31: the title alone; the two-sentence lead under it went (a
          post's Message box says the phone number stays private). */}
      <header className={styles.head}>
        <h1>{t('msg.title', language)}</h1>
      </header>
      <Tabs<InboxTab>
        label={t('msg.title', language)}
        value={tab}
        onChange={(next) => router.replace(next === 'chats' ? pathname : `${pathname}?tab=${next}`)}
        items={[
          { key: 'chats', label: t('msg.tabChats', language) },
          { key: 'archived', label: t('msg.tabArchived', language) },
          { key: 'ratings', label: t('msg.tabRatings', language) },
        ]}
      />
      {tab === 'ratings' ? (
        <MyRatingsPanel language={language} />
      ) : offline ? (
        <Notice kind="warn">{t('msg.offlineRead', language)}</Notice>
      ) : null}
      {tab === 'ratings' ? null : rows === null ? (
        <div className={styles.list} aria-busy>
          <Skeleton height={64} />
          <Skeleton height={64} />
        </div>
      ) : rows.length === 0 ? (
        offline ? null : tab === 'archived' ? (
          <EmptyState
            art="chat"
            title={t('msg.archivedEmpty', language)}
            body={t('msg.archivedEmptyBody', language)}
          />
        ) : (
          <EmptyState
            art="chat"
            title={t('msg.empty', language)}
            body={t('msg.emptyBody', language)}
          />
        )
      ) : (
        <ul className={styles.list}>
          {rows.map((c) => (
            <li key={c.id}>
              <Link
                href={`${pathname}?c=${c.id}`}
                className={`${styles.row} ${c.unread ? styles.rowUnread : ''}`}
              >
                <span className={styles.rowTop}>
                  <span className={styles.rowName}>
                    {c.other_name}{' '}
                    <PresenceLine presence={c.presence} language={language} dotOnly />
                  </span>
                  <span className={styles.rowTime}>{formatDate(c.last_message_at, language)}</span>
                </span>
                <span className={styles.rowAbout}>{aboutLine(c, language)}</span>
                {c.last_message_preview ? (
                  <span className={styles.rowPreview}>
                    {c.last_from_me ? `${t('msg.you', language)}: ` : ''}
                    {c.last_message_preview}
                  </span>
                ) : null}
                {c.unread ? <span className={styles.dot} aria-label="unread" /> : null}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** Messages in order, without the same id twice. */
function merge(a: readonly ChatMessage[], b: readonly ChatMessage[]): ChatMessage[] {
  const byId = new Map<string, ChatMessage>();
  for (const m of [...a, ...b]) byId.set(m.id, m);
  return [...byId.values()].sort((x, y) => x.created_at.localeCompare(y.created_at));
}

/**
 * One conversation. `embedded` (2026-10-22) is the thread alone, for a page
 * that already says what it is about -- an advice request's page: no back
 * link, no heading, no marketplace safety line.
 */
export function ConversationThread({
  id,
  language,
  embedded = false,
}: {
  id: string;
  language: Language;
  embedded?: boolean;
}) {
  return <Conversation id={id} language={language} embedded={embedded} />;
}

function Conversation({
  id,
  language,
  embedded = false,
}: {
  id: string;
  language: Language;
  embedded?: boolean;
}) {
  const pathname = usePathname();
  const side = pathname.startsWith('/buyer') ? 'buyer' : 'farmer';
  const [conversation, setConversation] = useState<ConversationSummary | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [waiting, setWaiting] = useState<ChatMessage[]>([]);
  const [problem, setProblem] = useState<'offline' | 'missing' | null>(null);
  const [draft, setDraft] = useState('');
  /** 2026-10-28: this person is blocked (person level), or the refusal to say why not. */
  const [personBlocked, setPersonBlocked] = useState(false);
  const [blockProblem, setBlockProblem] = useState<string | null>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const latest = useRef<string | null>(null);

  const refreshWaiting = useCallback(() => {
    waitingMessages(id)
      .then(setWaiting)
      .catch(() => undefined);
  }, [id]);

  const load = useCallback(async () => {
    try {
      // Ask from a little before the newest seen, so a message stored a moment
      // late is not missed; merge drops the repeats.
      const after = latest.current
        ? new Date(Date.parse(latest.current) - 30_000).toISOString()
        : undefined;
      const got = await openConversation(id, after);
      setConversation(got.conversation);
      setProblem(null);
      setMessages((prev) => {
        const next = merge(prev, got.messages);
        latest.current = next.at(-1)?.created_at ?? latest.current;
        return next;
      });
      if (!after || got.messages.length > 0) messagesChanged();
    } catch (e) {
      if (e instanceof MessagesError && e.status === 404) setProblem('missing');
      else if (e instanceof MessagesError && e.status === 0) setProblem('offline');
    }
  }, [id]);

  useEffect(() => {
    void load();
    refreshWaiting();
    const timer = setInterval(() => {
      if (document.visibilityState === 'visible') void load();
    }, MESSAGE_POLL_MS);
    const off = subscribeOutbox(() => {
      refreshWaiting();
      void load();
    });
    // 2026-10-26: a new message here arrives at once over the live channel.
    const onLive = (e: Event) => {
      const live = (e as CustomEvent<LiveEvent>).detail;
      if (live.event === 'message.created' && live.data.conversation_id === id) void load();
    };
    window.addEventListener(LIVE_EVENT, onLive);
    return () => {
      clearInterval(timer);
      off();
      window.removeEventListener(LIVE_EVENT, onLive);
    };
  }, [load, refreshWaiting, id]);

  const shown = merge(
    messages,
    waiting.filter((w) => !messages.some((m) => m.id === w.id)),
  );
  const waitingIds = new Set(
    waiting.filter((w) => !messages.some((m) => m.id === w.id)).map((w) => w.id),
  );

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: 'end' });
  }, [shown.length]);

  async function send(event: React.FormEvent) {
    event.preventDefault();
    const body = draft.trim();
    if (!body || !conversation) return;
    const queued = await queueMessage(conversation.id, conversation.other_name, body);
    if (queued) {
      setDraft('');
      setWaiting((w) => merge(w, [queued]));
    }
  }

  /** 2026-11-03: "Archive for me", or bring it back. Nobody else sees a change. */
  const [archiveProblem, setArchiveProblem] = useState(false);
  async function toggleArchive() {
    if (!conversation) return;
    setArchiveProblem(false);
    try {
      setConversation(await archiveConversation(conversation.id, !conversation.archived));
    } catch {
      // The button stays; the person can try again.
      setArchiveProblem(true);
    }
  }
  const archiveButton = conversation ? (
    <Button variant="ghost" size="small" onClick={() => void toggleArchive()}>
      {t(conversation.archived ? 'msg.unarchive' : 'msg.archive', language)}
    </Button>
  ) : null;

  async function blockThePerson() {
    if (!conversation || !window.confirm(t('msg.blockPersonConfirm', language))) return;
    setBlockProblem(null);
    try {
      await blockPerson(conversation.id);
      setPersonBlocked(true);
    } catch (e) {
      setBlockProblem(e instanceof Error ? e.message : null);
    }
  }

  if (problem === 'missing') {
    return (
      <div className={styles.page}>
        {embedded ? null : (
          <Link href={pathname} className={styles.back}>
            ← {t('msg.back', language)}
          </Link>
        )}
        <EmptyState title={t('msg.notFound', language)} body="" />
      </div>
    );
  }

  return (
    <div className={styles.page}>
      {embedded ? null : (
        <Link href={pathname} className={styles.back}>
          ← {t('msg.back', language)}
        </Link>
      )}
      {embedded ? (
        conversation ? (
          <div className={styles.chatHead}>
            <span />
            {archiveButton}
          </div>
        ) : null
      ) : conversation ? (
        <header className={styles.chatHead}>
          <div>
            <h1 className={styles.chatName}>{conversation.other_name}</h1>
            {/* 2026-10-26: "Online" / "Active 5 minutes ago", where both allow it. */}
            <PresenceLine presence={conversation.presence} language={language} />
            <Link
              href={postHref(conversation.post_kind, conversation.post_id, side)}
              className={styles.rowAbout}
            >
              {aboutLine(conversation, language)}
            </Link>
          </div>
          <div>
            {archiveButton}
            {personBlocked ? null : (
              <Button variant="ghost" size="small" onClick={() => void blockThePerson()}>
                {t('msg.blockPerson', language)}
              </Button>
            )}
          </div>
        </header>
      ) : (
        <Skeleton width="50%" height={28} />
      )}
      {personBlocked ? <Notice kind="info">{t('msg.personBlocked', language)}</Notice> : null}
      {conversation?.archived ? (
        <Notice kind="info">{t('msg.archivedNote', language)}</Notice>
      ) : null}
      {archiveProblem ? <Notice kind="error">{t('msg.archiveFailed', language)}</Notice> : null}
      {blockProblem ? <Notice kind="error">{blockProblem}</Notice> : null}
      {problem === 'offline' ? <Notice kind="warn">{t('msg.offlineRead', language)}</Notice> : null}
      {embedded ? null : <p className={styles.safety}>{t('msg.privacy', language)}</p>}

      <ol className={styles.thread} aria-live="polite">
        {shown.map((m) => (
          <li key={m.id} className={m.from_me ? styles.mine : styles.theirs}>
            <p className={styles.bubble} dir="auto">
              {m.body}
            </p>
            <span className={styles.meta}>
              {waitingIds.has(m.id)
                ? t('msg.waiting', language)
                : new Date(m.created_at).toLocaleString(language === 'ar' ? 'ar' : 'en-GB', {
                    day: 'numeric',
                    month: 'short',
                    hour: '2-digit',
                    minute: '2-digit',
                  })}
              {/* 2026-10-27: in an organisation's shared inbox, which colleague wrote. */}
              {m.sent_by ? ` · ${m.sent_by}` : ''}
            </span>
          </li>
        ))}
      </ol>
      <div ref={endRef} />

      {conversation?.blocked ? (
        <Notice kind="info">{t('msg.blocked', language)}</Notice>
      ) : conversation ? (
        <form className={styles.compose} onSubmit={(e) => void send(e)}>
          <textarea
            className={styles.input}
            value={draft}
            maxLength={MESSAGE_MAX_LENGTH}
            rows={2}
            dir="auto"
            placeholder={t('msg.placeholder', language)}
            aria-label={t('msg.placeholder', language)}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (
                e.key === 'Enter' &&
                !e.shiftKey &&
                window.matchMedia('(pointer: fine)').matches
              ) {
                e.preventDefault();
                void send(e);
              }
            }}
          />
          <Button type="submit" disabled={!draft.trim()}>
            {t('msg.send', language)}
          </Button>
        </form>
      ) : null}
    </div>
  );
}
