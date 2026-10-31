'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';

import { AccountAnnouncements } from '@/components/account/NotificationSettings';
import { EmptyState } from '@/components/ui';
import nc from '@/components/account/notifications.module.css';
import { bucketLabel, groupByDay, noticeTime } from '@/components/messages/when';
import {
  ACCOUNT_NOTICES,
  FARMER_CANCEL_NOTICE,
  FARMER_REQUEST_NOTICE,
  MATCH_NOTICES,
  noticeKey,
  popHref,
} from '@/lib/farmer-notices';
import { farmerApi, FarmerApiError, useFarmerSession } from '@/lib/farmer-session';
import { notificationsChanged } from '@/lib/farmer-unread';
import { loadWithSnapshot } from '@/lib/offline/snapshot';
import { t, type Language, type TKey } from '@/lib/i18n';

import { PageHead } from './AccountShell';
import {
  DirArrow,
  IconBell,
  IconCart,
  IconChat,
  IconSearch,
  IconStar,
} from '@/components/ui/icons';

interface NotificationRow {
  id: string;
  title: string;
  body: string;
  read_at: string | null;
  created_at: string;
  /** 2026-11-01: what the notice opens; null on older notices. */
  ref_kind?: string | null;
  ref_id?: string | null;
}

/** This page itself: a notice whose only place is here gets no link. */
const NOTIFICATIONS_HREF = '/farmer/account/notifications';

/**
 * 2026-10-31 (ui-delight): what kind a notice is, for its small icon. A
 * notice row has no type column, so this reads what it does carry: what it
 * points at (ref_kind) and its fixed title. A notice it cannot place (an
 * official announcement, an older free-text notice, an account decision)
 * gets the plain bell. Shared with the buyer's list.
 */
export type NoticeKind = 'request' | 'message' | 'rating' | 'match' | 'other';

const MATCH_TITLES: ReadonlySet<string> = new Set(
  [...MATCH_NOTICES].map((k) => ACCOUNT_NOTICES[k].title),
);
const MESSAGE_TITLES: ReadonlySet<string> = new Set([
  ACCOUNT_NOTICES.message_listing.title,
  ACCOUNT_NOTICES.message_buying_request.title,
  ACCOUNT_NOTICES.message_service.title,
  ACCOUNT_NOTICES.message_advice_case.title,
]);
const REQUEST_TITLES: ReadonlySet<string> = new Set([
  FARMER_REQUEST_NOTICE.title,
  FARMER_CANCEL_NOTICE.title,
]);

export function noticeKind(title: string, refKind?: string | null): NoticeKind {
  if (MATCH_TITLES.has(title)) return 'match';
  if (refKind === 'conversation' || MESSAGE_TITLES.has(title)) return 'message';
  if (refKind === 'rating' || title === ACCOUNT_NOTICES.rating_received.title) return 'rating';
  if (REQUEST_TITLES.has(title)) return 'request';
  return 'other';
}

const KIND_CLASS: Record<NoticeKind, string | undefined> = {
  request: nc.kindRequest,
  message: nc.kindMessage,
  rating: nc.kindRating,
  match: nc.kindMatch,
  other: undefined,
};

/** The small round icon of a notice's kind. Decorative: the title says what it is. */
export function NoticeIcon({ kind }: { kind: NoticeKind }) {
  const Icon =
    kind === 'request'
      ? IconCart
      : kind === 'message'
        ? IconChat
        : kind === 'rating'
          ? IconStar
          : kind === 'match'
            ? IconSearch
            : IconBell;
  return (
    <span className={`${nc.icon} ${KIND_CLASS[kind] ?? ''}`} aria-hidden="true">
      <Icon size={18} />
    </span>
  );
}

/**
 * The farmer's in-app notices (B14): GET /api/farmer/notifications. Opening
 * the page marks what it shows as read.
 */
export function FarmerNotifications() {
  const { language } = useFarmerSession();

  const [notifications, setNotifications] = useState<readonly NotificationRow[]>([]);

  useEffect(() => {
    let cancelled = false;
    // PWA (2026-10-10): with no signal, the alerts saved on this phone.
    loadWithSnapshot(
      'farmer.notifications',
      () => farmerApi<NotificationRow[]>('/api/farmer/notifications'),
      (e) => e instanceof FarmerApiError && e.status === 0,
    )
      .then((got) => {
        if (cancelled || !got) return;
        const rows = got.data;
        setNotifications(rows);
        // Marked read only when they came from the server just now.
        if (!got.fresh) return;
        const unread = rows.filter((r) => !r.read_at);
        if (unread.length === 0) return;
        void Promise.all(
          unread.map((n) =>
            farmerApi(`/api/farmer/notifications/${n.id}`, {
              method: 'PATCH',
              body: JSON.stringify({}),
            }).catch(() => undefined),
          ),
        ).then(notificationsChanged);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <>
      <PageHead title={t('notifications.title', language)} />
      {/* 2026-10-27: official announcements, also listed among the notices below. */}
      <AccountAnnouncements language={language} />
      {notifications.length === 0 ? (
        // 2026-10-31: the title alone (the body repeated "Notifications").
        <EmptyState art="bell" title={t('notifications.empty', language)} />
      ) : (
        // 2026-10-31 (ui-delight): under Today, Yesterday and Earlier.
        <div className={nc.groups}>
          {groupByDay(notifications).map((group) => (
            <section key={group.bucket} className={nc.group}>
              <h2 className={nc.groupTitle}>{bucketLabel(group.bucket, language)}</h2>
              <ul className={nc.list}>
                {group.rows.map((n) => (
                  <NotificationCard key={n.id} notification={n} language={language} />
                ))}
              </ul>
            </section>
          ))}
        </div>
      )}
    </>
  );
}

function NotificationCard({
  notification,
  language,
}: {
  notification: NotificationRow;
  language: Language;
}) {
  const unread = !notification.read_at;
  // 2026-10-10 (CORWADO): a notice about a request opens the request.
  // 2026-11-01 (live test): a notice about one post or conversation opens
  // it, exactly as its live pop does; an older notice opens where it did.
  const opens = popHref({
    side: 'farmer',
    title: notification.title,
    refKind: notification.ref_kind,
    refId: notification.ref_id,
  });
  const href = opens === NOTIFICATIONS_HREF ? null : opens;
  // 2026-10-26: a fixed notice is shown in the farmer's language; an older one as stored.
  const key = noticeKey(notification.title);
  const title = key ? t(`${key}.title` as TKey, language) : notification.title;
  const body = key ? t(`${key}.body` as TKey, language) : notification.body;
  const content = (
    <>
      <NoticeIcon kind={noticeKind(notification.title, notification.ref_kind)} />
      <span className={nc.text}>
        <span className={nc.title} dir="auto">
          {title}
        </span>
        <span className={nc.body} dir="auto">
          {body}
        </span>
        <span className={nc.meta}>
          <time dateTime={notification.created_at}>
            {noticeTime(notification.created_at, language)}
          </time>
          {href ? (
            <>
              {' · '}
              {language === 'ar' ? 'افتح' : 'Open'} <DirArrow />
            </>
          ) : null}
        </span>
      </span>
      {unread ? (
        <span className={nc.dot}>
          <span className="visually-hidden">{t('buyer.notif.new', language)}</span>
        </span>
      ) : null}
    </>
  );

  return (
    <li className={`${nc.item} ${unread ? nc.unread : ''}`}>
      {href ? (
        <Link href={href} className={nc.link}>
          {content}
        </Link>
      ) : (
        <div className={nc.link}>{content}</div>
      )}
    </li>
  );
}
