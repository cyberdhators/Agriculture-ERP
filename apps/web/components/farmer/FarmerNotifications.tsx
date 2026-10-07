'use client';

import { useEffect, useState } from 'react';

import { EmptyState } from '@/components/ui';
import { farmerApi, useFarmerSession } from '@/lib/farmer-session';
import { formatDate } from '@/lib/format';
import { t, type Language } from '@/lib/i18n';

import { PageHead } from './AccountShell';
import styles from './farmer.module.css';

interface NotificationRow {
  id: string;
  title: string;
  body: string;
  read_at: string | null;
  created_at: string;
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
    farmerApi<NotificationRow[]>('/api/farmer/notifications')
      .then((rows) => {
        if (cancelled) return;
        setNotifications(rows);
        for (const n of rows.filter((r) => !r.read_at)) {
          void farmerApi(`/api/farmer/notifications/${n.id}`, {
            method: 'PATCH',
            body: JSON.stringify({}),
          }).catch(() => undefined);
        }
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <>
      <PageHead title={t('notifications.title', language)} />
      {notifications.length === 0 ? (
        <EmptyState
          title={t('notifications.empty', language)}
          body={t('notifications.title', language)}
        />
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

  return (
    <li className={`${styles.notiItem} ${unread ? styles.notiUnread : ''}`}>
      <div className={styles.notiTitle}>{notification.title}</div>
      <p className="small">{notification.body}</p>
      <span className="small muted">{formatDate(notification.created_at, language)}</span>
    </li>
  );
}
