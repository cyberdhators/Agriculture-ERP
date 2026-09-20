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

const FIXTURE_NOTIFICATIONS: readonly NotificationRow[] = [
  {
    id: 'n1',
    channel: 'in_app',
    title: 'Your listing was approved',
    body: 'Your listing "Sorghum — 50 bags" is now live on the marketplace.',
    read_at: null,
    created_at: '2026-09-19T10:00:00Z',
  },
  {
    id: 'n2',
    channel: 'in_app',
    title: 'New buyer enquiry',
    body: 'A buyer is interested in your groundnut listing. Your officer will call you.',
    read_at: null,
    created_at: '2026-09-18T14:30:00Z',
  },
  {
    id: 'n3',
    channel: 'in_app',
    title: 'Weather advisory',
    body: 'Heavy rain expected in your area over the next two days. Consider protecting stored harvest.',
    read_at: '2026-09-17T09:00:00Z',
    created_at: '2026-09-16T08:00:00Z',
  },
];

export function FarmerNotifications() {
  const { language } = useFarmerSession();

  const notifications = FIXTURE_NOTIFICATIONS;

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
