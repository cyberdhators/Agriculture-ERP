'use client';

import { useState } from 'react';

import { listNotifications, markNotificationRead } from '@/lib/buyer/api';
import { formatDate } from '@/lib/format';

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
  const { refreshUnread } = useBuyer();
  const [view, setView] = useState<'all' | 'unread'>('all');
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
      <PageHeader title="Notifications" subtitle="Updates on your account, requests and orders." />
      <Tabs
        label="Which notifications"
        value={view}
        onChange={setView}
        items={[
          { key: 'all', label: 'All' },
          { key: 'unread', label: 'Unread' },
        ]}
      />
      {list.error ? (
        <EmptyState
          error
          title="Notifications could not be loaded"
          body={list.error}
          actions={<Button onClick={list.reload}>Try again</Button>}
        />
      ) : list.loading ? (
        <LoadingState rows={4} />
      ) : list.rows.length === 0 ? (
        <EmptyState
          title={view === 'unread' ? 'Nothing unread' : 'No notifications yet'}
          body="You will be told here when CORWADO reviews your account, decides a request or updates an order."
        />
      ) : (
        <>
          {list.rows.map((n) => (
            <Card key={n.id}>
              <CardBody>
                <div className={styles.standing}>
                  <div>
                    <p>
                      <strong>{n.title}</strong>{' '}
                      {n.read_at ? null : <Badge tone="sorghum">New</Badge>}
                    </p>
                    <p>{n.body}</p>
                    <p className={styles.muted}>{formatDate(n.created_at)}</p>
                  </div>
                  {n.read_at ? null : (
                    <Button
                      variant="secondary"
                      size="small"
                      disabled={marking === n.id}
                      onClick={() => void markRead(n.id)}
                    >
                      Mark as read
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
          />
        </>
      )}
    </div>
  );
}
