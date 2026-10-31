'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';

import { AccountAnnouncements } from '@/components/account/NotificationSettings';
import { EmptyState } from '@/components/ui';
import { noticeKey, popHref } from '@/lib/farmer-notices';
import { farmerApi, FarmerApiError, useFarmerSession } from '@/lib/farmer-session';
import { notificationsChanged } from '@/lib/farmer-unread';
import { loadWithSnapshot } from '@/lib/offline/snapshot';
import { formatDate } from '@/lib/format';
import { t, type Language, type TKey } from '@/lib/i18n';

import { PageHead } from './AccountShell';
import styles from './farmer.module.css';

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
        <ul className={styles.notiList}>
          {notifications.map((n) => (
            <NotificationCard key={n.id} notification={n} language={language} />
          ))}
        </ul>
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
      <div className={styles.notiTitle}>{title}</div>
      <p className="small">{body}</p>
      <span className="small muted">
        {formatDate(notification.created_at, language)}
        {href ? ` · ${language === 'ar' ? 'افتح' : 'Open'} →` : ''}
      </span>
    </>
  );

  return (
    <li className={`${styles.notiItem} ${unread ? styles.notiUnread : ''}`}>
      {href ? (
        <Link href={href} className={styles.notiLink}>
          {content}
        </Link>
      ) : (
        content
      )}
    </li>
  );
}
