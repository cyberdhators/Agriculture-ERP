'use client';

import { EmptyState } from '@/components/ui';
import { useFarmerSession } from '@/lib/farmer-session';
import { formatDate } from '@/lib/format';
import { t, type Language } from '@/lib/i18n';

import { PageHead } from './AccountShell';
import styles from './farmer.module.css';

interface NotificationRow {
  id: string;
  channel: string;
  title: string;
  body: string;
  read_at: string | null;
  created_at: string;
}

// Notifications will come from the notification API (deliverable (n))
// once it is wired. Until then, empty state.

export function FarmerNotifications() {
  const { language } = useFarmerSession();

  const notifications: readonly NotificationRow[] = [];

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
