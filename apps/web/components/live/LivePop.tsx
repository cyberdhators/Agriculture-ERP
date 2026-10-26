'use client';

import Link from 'next/link';
import { usePathname, useSearchParams } from 'next/navigation';
import { Suspense, useCallback, useEffect, useRef, useState, type PointerEvent } from 'react';

import { noticeKey, popHref } from '@/lib/farmer-notices';
import { formatDate } from '@/lib/format';
import { isRtl, t, type Language, type TKey } from '@/lib/i18n';
import { liveMe, startLive, useLiveEvent, type LiveEvent } from '@/lib/realtime/client';
import {
  dismissPop,
  livePops,
  nextExpiry,
  popIconFor,
  pushPop,
  type Pop,
  type PopIcon,
} from '@/lib/realtime/toast-queue';

import styles from './live.module.css';

/**
 * THE LIVE POP (2026-10-26). A card slides down from the top when a notice
 * or a message arrives while the app is open: what kind it is, its title, a
 * line, the time. Tapping opens it; it leaves by itself after six seconds,
 * or with a swipe or the close button; at most three stack.
 *
 * The TEXT comes from the stored notice, read by id through the session
 * (GET /api/account/notifications/:id), and is shown in the person's
 * language the way the notifications page shows it. The live event itself
 * carries ids only. A message pop says only "New message".
 *
 * A short tone (Web Audio, no file) and a vibration on phones, unless muted
 * with the bell on the card (remembered on this device). Respects
 * prefers-reduced-motion. An aria-live region reads each card politely.
 */

const MUTE_KEY = 'agrione-live-muted';
/** A message pop waits this long, so the notice about the same conversation (if any) wins. */
const MESSAGE_POP_DELAY_MS = 700;

function readMuted(): boolean {
  try {
    return window.localStorage.getItem(MUTE_KEY) === '1';
  } catch {
    return false;
  }
}

function writeMuted(muted: boolean): void {
  try {
    window.localStorage.setItem(MUTE_KEY, muted ? '1' : '0');
  } catch {
    // Storage blocked: the choice lasts for this page only.
  }
}

let audio: AudioContext | null = null;

/** Two soft notes, about a quarter of a second. Silent if the browser refuses. */
function chime(): void {
  try {
    const Ctx =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctx) return;
    audio ??= new Ctx();
    const now = audio.currentTime;
    for (const [i, freq] of [880, 1320].entries()) {
      const osc = audio.createOscillator();
      const gain = audio.createGain();
      osc.type = 'sine';
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0.0001, now + i * 0.12);
      gain.gain.exponentialRampToValueAtTime(0.08, now + i * 0.12 + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + i * 0.12 + 0.18);
      osc.connect(gain).connect(audio.destination);
      osc.start(now + i * 0.12);
      osc.stop(now + i * 0.12 + 0.2);
    }
  } catch {
    // No sound: the card is enough.
  }
}

async function readNotice(
  id: string,
): Promise<{ title: string; body: string; created_at: string } | null> {
  try {
    const res = await fetch(`/api/account/notifications/${encodeURIComponent(id)}`, {
      cache: 'no-store',
    });
    if (!res.ok) return null;
    const body = (await res.json()) as {
      data?: { title: string; body: string; created_at: string };
    };
    return body.data ?? null;
  } catch {
    return null;
  }
}

function Glyph({ icon }: { icon: PopIcon }) {
  const common = {
    viewBox: '0 0 24 24',
    width: 22,
    height: 22,
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 1.8,
    'aria-hidden': true,
  } as const;
  if (icon === 'match') {
    return (
      <svg {...common}>
        <path d="M12 21s-7-4.4-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 11c0 5.6-7 10-7 10Z" />
      </svg>
    );
  }
  if (icon === 'message') {
    return (
      <svg {...common}>
        <path d="M4 5h16v11H8l-4 4V5Z" />
      </svg>
    );
  }
  if (icon === 'essential') {
    return (
      <svg {...common}>
        <path d="M12 3 2 20h20L12 3Z" />
        <path d="M12 10v4M12 17v.5" />
      </svg>
    );
  }
  return (
    <svg {...common}>
      <path d="M6 16V11a6 6 0 0 1 12 0v5l2 2H4l2-2Z" />
      <path d="M10 20a2 2 0 0 0 4 0" />
    </svg>
  );
}

interface LivePopProps {
  /** Which side's pages the links open: the farmer workspace or the buyer one. */
  side: 'farmer' | 'buyer';
  language: Language;
}

/** Mounted once in each shell. Suspense: it reads the URL to skip the open conversation. */
export function LivePop(props: LivePopProps) {
  return (
    <Suspense fallback={null}>
      <LivePopInner {...props} />
    </Suspense>
  );
}

function LivePopInner({ side, language }: LivePopProps) {
  const [pops, setPops] = useState<Pop[]>([]);
  const [muted, setMuted] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const pathname = usePathname();
  const params = useSearchParams();
  const openConversation = pathname.endsWith('/messages') ? params.get('c') : null;
  const where = useRef({ openConversation, muted });
  where.current = { openConversation, muted };

  useEffect(() => {
    setMuted(readMuted());
    startLive();
  }, []);

  // Each card leaves on time: one timer, for the next to expire.
  useEffect(() => {
    const wait = nextExpiry(pops, Date.now());
    if (wait === null) return;
    const timer = window.setTimeout(() => {
      const at = Date.now();
      setNow(at);
      setPops((q) => livePops(q, at));
    }, wait + 20);
    return () => window.clearTimeout(timer);
  }, [pops]);

  const show = useCallback((pop: Pop) => {
    setPops((q) => {
      const next = pushPop(q, pop, Date.now());
      if (next[0]?.id === pop.id && !where.current.muted) {
        chime();
        try {
          navigator.vibrate?.(60);
        } catch {
          // Not a phone, or not allowed.
        }
      }
      return next;
    });
    setNow(Date.now());
  }, []);

  useLiveEvent((e: LiveEvent) => {
    if (e.event === 'notification.created') {
      const d = e.data;
      void readNotice(d.notification_id).then((notice) => {
        if (!notice) return;
        const key = noticeKey(notice.title);
        show({
          id: d.notification_id,
          key:
            d.ref_kind === 'conversation' && d.ref_id
              ? `conv:${d.ref_id}`
              : `n:${d.notification_id}`,
          icon: popIconFor(d.kind, d.notice),
          title: key ? t(`${key}.title` as TKey, language) : notice.title,
          body: key ? t(`${key}.body` as TKey, language) : notice.body,
          href: popHref({ side, title: notice.title, refKind: d.ref_kind, refId: d.ref_id }),
          at: Date.now(),
        });
      });
      return;
    }
    const d = e.data;
    if (d.sender === liveMe()) return;
    if (where.current.openConversation === d.conversation_id) return;
    window.setTimeout(() => {
      if (where.current.openConversation === d.conversation_id) return;
      show({
        id: `m:${d.message_id}`,
        key: `conv:${d.conversation_id}`,
        icon: 'message',
        title: t('live.newMessage.title', language),
        body: t('live.newMessage.body', language),
        href: popHref({
          side,
          title: null,
          refKind: 'conversation',
          refId: d.conversation_id,
        }),
        at: Date.now(),
      });
    }, MESSAGE_POP_DELAY_MS);
  });

  const toggleMute = () => {
    const next = !muted;
    setMuted(next);
    writeMuted(next);
  };

  const shown = livePops(pops, now);
  const rtl = isRtl(language);

  return (
    <div
      className={styles.region}
      dir={rtl ? 'rtl' : 'ltr'}
      role="region"
      aria-label={t('live.region', language)}
    >
      <div className="visually-hidden" aria-live="polite" aria-atomic="false" role="status">
        {shown.map((p) => (
          <p key={p.id}>
            {p.title}. {p.body}
          </p>
        ))}
      </div>
      {shown.map((p) => (
        <PopCard
          key={p.id}
          pop={p}
          language={language}
          muted={muted}
          onMute={toggleMute}
          onClose={() => setPops((q) => dismissPop(q, p.id))}
        />
      ))}
    </div>
  );
}

function PopCard({
  pop,
  language,
  muted,
  onMute,
  onClose,
}: {
  pop: Pop;
  language: Language;
  muted: boolean;
  onMute: () => void;
  onClose: () => void;
}) {
  const start = useRef<number | null>(null);
  const [dx, setDx] = useState(0);

  const down = (e: PointerEvent<HTMLDivElement>) => {
    start.current = e.clientX;
  };
  const move = (e: PointerEvent<HTMLDivElement>) => {
    if (start.current !== null) setDx(e.clientX - start.current);
  };
  const up = () => {
    if (Math.abs(dx) > 80) onClose();
    else setDx(0);
    start.current = null;
  };

  const ago =
    Date.now() - pop.at < 60_000
      ? t('live.justNow', language)
      : formatDate(new Date(pop.at).toISOString(), language);

  return (
    <div
      className={`${styles.card} ${styles[`icon_${pop.icon}`] ?? ''}`}
      style={
        dx
          ? { transform: `translateX(${dx}px)`, opacity: Math.max(0.2, 1 - Math.abs(dx) / 240) }
          : undefined
      }
      onPointerDown={down}
      onPointerMove={move}
      onPointerUp={up}
      onPointerCancel={up}
    >
      <Link href={pop.href} className={styles.link} onClick={onClose}>
        <span className={styles.glyph}>
          <Glyph icon={pop.icon} />
        </span>
        <span className={styles.text}>
          <span className={styles.title}>{pop.title}</span>
          <span className={styles.body}>{pop.body}</span>
          <span className={styles.time}>{ago}</span>
        </span>
      </Link>
      <span className={styles.actions}>
        <button
          type="button"
          className={styles.iconButton}
          onClick={onMute}
          aria-label={t(muted ? 'live.unmute' : 'live.mute', language)}
          title={t(muted ? 'live.unmute' : 'live.mute', language)}
        >
          <svg
            viewBox="0 0 24 24"
            width="16"
            height="16"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
            aria-hidden
          >
            <path d="M4 9h4l5-4v14l-5-4H4V9Z" />
            {muted ? <path d="M17 9l4 6M21 9l-4 6" /> : <path d="M17 9a4 4 0 0 1 0 6" />}
          </svg>
        </button>
        <button
          type="button"
          className={styles.iconButton}
          onClick={onClose}
          aria-label={t('live.close', language)}
          title={t('live.close', language)}
        >
          <svg
            viewBox="0 0 24 24"
            width="16"
            height="16"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            aria-hidden
          >
            <path d="M6 6l12 12M18 6 6 18" />
          </svg>
        </button>
      </span>
    </div>
  );
}
