'use client';

import { useState } from 'react';

import {
  AccountAnnouncements,
  NotificationPreferencesCard,
} from '@/components/account/NotificationSettings';
import { listNotifications, markNotificationRead } from '@/lib/buyer/api';
import { formatDate } from '@/lib/format';
import { t } from '@/lib/i18n';

import { Badge, Button, Card, CardBody, EmptyState, PageHeader, Tabs } from '../ui';
import { LoadingState, Pagination } from '../ui/data';
import { useBuyer } from './BuyerShell';
import { useCursorList } from './useCursorList';
import styles from './buyer.module.css';

/**
 * NOTIFICATIONS (C-14B.20). The organisation's in-app notices from the
 * existing notification table: account decisions, request decisions, orders
 * and their progress. Each is a fixed sentence; none names a person.
 */
export function BuyerNotifications() {
  const { refreshUnread, language } = useBuyer();
  const [view, setView] = useState<'all' | 'unread' | 'announcements' | 'settings'>('all');
  const list = useCursorList((cursor) => listNotifications(view === 'unread', cursor), view);
  const [marking, setMarking] = useState<string | null>(null);

  const markRead = async (id: string) => {
    setMarking(id);
    try {
      await markNotificationRead(id);
      list.reload();
      refreshUnread();
    } finally {
      setMarking(null);
    }
  };

  return (
    <div className={styles.page}>
      <PageHeader
        title={t('buyer.nav.notifications', language)}
        subtitle={t('buyer.notif.lead', language)}
      />
      <Tabs
        label={t('buyer.notif.which', language)}
        value={view}
        onChange={setView}
        items={[
          { key: 'all', label: t('buyer.notif.all', language) },
          { key: 'unread', label: t('buyer.notif.unread', language) },
          // 2026-10-27: official announcements and what this account receives.
          { key: 'announcements', label: t('announcements.title', language) },
          { key: 'settings', label: t('prefs.title', language) },
        ]}
      />
      {view === 'announcements' ? (
        <AccountAnnouncements language={language} />
      ) : view === 'settings' ? (
        <NotificationPreferencesCard emailAccount language={language} />
      ) : list.error ? (
        <EmptyState
          error
          title={t('buyer.notif.loadFailed', language)}
          body={list.error}
          actions={<Button onClick={list.reload}>{t('buyer.common.retry', language)}</Button>}
        />
      ) : list.loading ? (
        <LoadingState rows={4} label={t('buyer.common.loading', language)} />
      ) : list.rows.length === 0 ? (
        <EmptyState
          title={
            view === 'unread'
              ? t('buyer.notif.nothingUnread', language)
              : t('buyer.notif.none', language)
          }
          body={t('buyer.notif.noneBody', language)}
        />
      ) : (
        <>
          {list.rows.map((n) => (
            <Card key={n.id}>
              <CardBody>
                <div className={styles.standing}>
                  <div>
                    <p>
                      <strong dir="auto">{n.title}</strong>{' '}
                      {n.read_at ? null : (
                        <Badge tone="sorghum">{t('buyer.notif.new', language)}</Badge>
                      )}
                    </p>
                    <p dir="auto">{n.body}</p>
                    <p className={styles.muted}>{formatDate(n.created_at, language)}</p>
                  </div>
                  {n.read_at ? null : (
                    <Button
                      variant="secondary"
                      size="small"
                      disabled={marking === n.id}
                      onClick={() => void markRead(n.id)}
                    >
                      {t('buyer.notif.markRead', language)}
                    </Button>
                  )}
                </div>
              </CardBody>
            </Card>
          ))}
          <Pagination
            shown={list.rows.length}
            hasMore={list.hasMore}
            onNext={list.goNext}
            onPrevious={list.goBack}
            canGoBack={list.canGoBack}
            language={language}
          />
        </>
      )}
    </div>
  );
}
