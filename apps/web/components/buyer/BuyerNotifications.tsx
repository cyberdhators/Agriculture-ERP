'use client';

import Link from 'next/link';
import { useState } from 'react';

import {
  AccountAnnouncements,
  NotificationPreferencesCard,
} from '@/components/account/NotificationSettings';
import { listNotifications, markNotificationRead, type BuyerNotification } from '@/lib/buyer/api';
import { popHref } from '@/lib/farmer-notices';
import { t } from '@/lib/i18n';

import nc from '@/components/account/notifications.module.css';
import { NoticeIcon, noticeKind } from '@/components/farmer/FarmerNotifications';
import { bucketLabel, groupByDay, noticeTime } from '@/components/messages/when';

import { Button, EmptyState, PageHeader, Tabs } from '../ui';
import { LoadingState, Pagination } from '../ui/data';
import { useBuyer } from './BuyerShell';
import { useCursorList } from './useCursorList';
import styles from './buyer.module.css';
import { DirArrow } from '@/components/ui/icons';

/**
 * NOTIFICATIONS (C-14B.20). The organisation's in-app notices from the
 * existing notification table: account decisions, request decisions, orders
 * and their progress. Each is a fixed sentence; none names a person.
 */
/** This page itself: a notice whose only place is here gets no link. */
const NOTIFICATIONS_HREF = '/buyer/notifications';

/**
 * 2026-11-01 (live test): where tapping a notice goes -- the exact post or
 * conversation it is about, as its live pop opens; null when it has nowhere
 * to open but this page.
 */
function opensAt(n: BuyerNotification): string | null {
  const href = popHref({ side: 'buyer', title: n.title, refKind: n.ref_kind, refId: n.ref_id });
  return href === NOTIFICATIONS_HREF ? null : href;
}

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
      {/* 2026-10-31: the title alone (the tabs say what is here), and the
          notices as rows of one white list rather than a card each. */}
      <PageHeader title={t('buyer.nav.notifications', language)} />
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
          art="bell"
          title={
            view === 'unread'
              ? t('buyer.notif.nothingUnread', language)
              : t('buyer.notif.none', language)
          }
        />
      ) : (
        <>
          {/* 2026-10-31 (ui-delight): under Today, Yesterday and Earlier, each
              row with a small icon of its kind; an unread row on a soft wash
              (the "New" badge went: the wash, the dot and "Mark as read" say it). */}
          <div className={nc.groups}>
            {groupByDay(list.rows).map((group) => (
              <section key={group.bucket} className={nc.group}>
                <h2 className={nc.groupTitle}>{bucketLabel(group.bucket, language)}</h2>
                <ul className={nc.list}>
                  {group.rows.map((n) => {
                    const href = opensAt(n);
                    return (
                      <li key={n.id} className={`${nc.item} ${n.read_at ? '' : nc.unread}`}>
                        <div className={nc.link}>
                          <NoticeIcon kind={noticeKind(n.title, n.ref_kind)} />
                          <div className={nc.text}>
                            <span className={nc.title} dir="auto">
                              {n.title}
                              {n.read_at ? null : (
                                <span className="visually-hidden">
                                  {' '}
                                  {t('buyer.notif.new', language)}
                                </span>
                              )}
                            </span>
                            <p className={nc.body} dir="auto">
                              {n.body}
                            </p>
                            <p className={nc.meta}>
                              <time dateTime={n.created_at}>
                                {noticeTime(n.created_at, language)}
                              </time>
                              {href ? (
                                <>
                                  {' · '}
                                  <Link href={href}>
                                    {language === 'ar' ? 'افتح' : 'Open'} <DirArrow />
                                  </Link>
                                </>
                              ) : null}
                            </p>
                          </div>
                        </div>
                        {n.read_at ? null : (
                          <span className={nc.action}>
                            <Button
                              variant="secondary"
                              size="small"
                              disabled={marking === n.id}
                              onClick={() => void markRead(n.id)}
                            >
                              {t('buyer.notif.markRead', language)}
                            </Button>
                          </span>
                        )}
                      </li>
                    );
                  })}
                </ul>
              </section>
            ))}
          </div>
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
