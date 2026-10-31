'use client';

import { useEffect, useState } from 'react';

import {
  DEFAULT_PREFERENCES,
  notificationPreferencesSchema,
  type AccountAnnouncement,
  type NotificationPreferences,
  type PreferenceField,
} from '@agri-erp/shared';

import { Badge, Button, Card, CardBody, CardHeader, Notice } from '@/components/ui';
import { formatDate } from '@/lib/format';
import { t, type Language } from '@/lib/i18n';

import css from './settings.module.css';

/**
 * NOTIFICATION SETTINGS AND ANNOUNCEMENTS FOR ONE ACCOUNT (2026-10-27).
 * Shown on the farmer's Account settings and on the buyer's Notifications
 * page; both read the same switches, keyed by the sign-in, so one account
 * buying and selling has one set.
 *
 * Essential and security messages have no switch, and the card says so.
 */

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    cache: 'no-store',
    ...init,
    headers: init?.body ? { 'content-type': 'application/json' } : undefined,
  });
  const body = (await res.json().catch(() => ({}))) as { data?: T };
  if (!res.ok || body.data === undefined) throw new Error(String(res.status));
  return body.data;
}

export function NotificationPreferencesCard({
  language = 'en',
  emailAccount,
}: {
  language?: Language;
  /** Whether this account signs in with an email address (a buyer account). */
  emailAccount: boolean;
}) {
  const [prefs, setPrefs] = useState<NotificationPreferences | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [state, setState] = useState<'idle' | 'saved' | 'failed'>('idle');

  useEffect(() => {
    let live = true;
    request<NotificationPreferences>('/api/account/notification-preferences')
      .then((p) => {
        if (live) setPrefs({ ...DEFAULT_PREFERENCES, ...p });
      })
      .catch(() => {
        if (live) setLoadFailed(true);
      });
    return () => {
      live = false;
    };
  }, []);

  const save = async () => {
    if (!prefs) return;
    const parsed = notificationPreferencesSchema.safeParse({
      announcements_in_app: prefs.announcements_in_app,
      announcements_sms: prefs.announcements_sms,
      announcements_email: prefs.announcements_email,
      updates_in_app: prefs.updates_in_app,
      match_in_app: prefs.match_in_app,
      match_sms: prefs.match_sms,
      show_activity: prefs.show_activity,
    });
    if (!parsed.success) return;
    setBusy(true);
    setState('idle');
    try {
      setPrefs(
        await request<NotificationPreferences>('/api/account/notification-preferences', {
          method: 'PUT',
          body: JSON.stringify(parsed.data),
        }),
      );
      setState('saved');
    } catch {
      setState('failed');
    } finally {
      setBusy(false);
    }
  };

  const shown = prefs ?? DEFAULT_PREFERENCES;
  const set = (field: PreferenceField, value: boolean) => setPrefs({ ...shown, [field]: value });

  // One row per switch. An email-only switch is not offered to an account
  // that has no email address, rather than offered with a note saying it
  // does nothing (2026-10-31).
  const row = (field: PreferenceField, label: string, hint?: string) => (
    <li key={field}>
      <label className={css.row}>
        <span className={css.rowText}>
          <span className={css.rowLabel}>{label}</span>
          {hint ? <span className={css.rowHint}>{hint}</span> : null}
        </span>
        <input
          type="checkbox"
          role="switch"
          className={css.switch}
          checked={shown[field]}
          disabled={!prefs || busy}
          onChange={(e) => set(field, e.target.checked)}
        />
      </label>
    </li>
  );

  return (
    <section className={css.group} aria-labelledby="prefs-title">
      <h2 id="prefs-title" className={css.groupTitle}>
        {t('set.notifications', language)}
      </h2>
      {loadFailed ? (
        <Notice kind="error">
          <p className="small">{t('prefs.loadFailed', language)}</p>
        </Notice>
      ) : null}
      <p className={css.subTitle}>{t('set.announcements', language)}</p>
      <ul className={css.list}>
        {row('announcements_in_app', t('set.inApp', language))}
        {row('announcements_sms', t('set.sms', language))}
        {emailAccount ? row('announcements_email', t('set.email', language)) : null}
      </ul>
      <p className={css.subTitle}>{t('set.activityGroup', language)}</p>
      <ul className={css.list}>
        {row('updates_in_app', t('set.updates', language), t('set.updatesHint', language))}
        {/* 2026-10-26: match alerts (marketing; SMS off unless turned on). */}
        {row('match_in_app', t('set.match', language), t('set.matchHint', language))}
        {row('match_sms', t('set.matchSms', language), t('set.matchSmsHint', language))}
        {/* 2026-10-26: online status in conversations, reciprocal. */}
        {row('show_activity', t('set.activity', language), t('set.activityHint', language))}
      </ul>
      {state === 'saved' ? <Notice kind="success">{t('prefs.saved', language)}</Notice> : null}
      {state === 'failed' ? (
        <Notice kind="error">
          <p className="small">{t('prefs.failed', language)}</p>
        </Notice>
      ) : null}
      <div className={css.foot}>
        <span className={css.note}>{t('set.essential', language)}</span>
        <Button onClick={() => void save()} disabled={!prefs || busy}>
          {t('set.save', language)}
        </Button>
      </div>
    </section>
  );
}

/** The official announcements this account received in the app. */
export function AccountAnnouncements({ language = 'en' }: { language?: Language }) {
  const [rows, setRows] = useState<AccountAnnouncement[] | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let live = true;
    request<AccountAnnouncement[]>('/api/account/announcements')
      .then((r) => {
        if (live) setRows(r);
      })
      .catch(() => {
        if (live) setFailed(true);
      });
    return () => {
      live = false;
    };
  }, []);

  return (
    <Card>
      <CardHeader title={t('announcements.title', language)} />
      <CardBody>
        {failed ? <p className="small muted">{t('announcements.empty', language)}</p> : null}
        {rows && rows.length === 0 ? (
          <p className="small muted">{t('announcements.empty', language)}</p>
        ) : null}
        {rows && rows.length > 0 ? (
          <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'grid', gap: 12 }}>
            {rows.map((a) => (
              <li key={a.id} style={{ borderTop: '1px solid var(--line)', paddingTop: 8 }}>
                <p dir="auto">
                  <strong>{a.title}</strong>{' '}
                  {a.category === 'essential' ? (
                    <Badge tone="clay">{t('announcements.essential', language)}</Badge>
                  ) : null}
                </p>
                <p className="small" dir="auto" style={{ whiteSpace: 'pre-wrap' }}>
                  {a.body}
                </p>
                <span className="small muted">{formatDate(a.sent_at, language)}</span>
              </li>
            ))}
          </ul>
        ) : null}
      </CardBody>
    </Card>
  );
}
