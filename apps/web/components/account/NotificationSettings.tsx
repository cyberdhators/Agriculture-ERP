'use client';

import { useEffect, useState } from 'react';

import {
  DEFAULT_PREFERENCES,
  notificationPreferencesSchema,
  type AccountAnnouncement,
  type NotificationPreferences,
  type PreferenceField,
} from '@agri-erp/shared';

import { Badge, Button, Card, CardBody, CardHeader, Checkbox, Notice } from '@/components/ui';
import { formatDate } from '@/lib/format';
import { t, type Language } from '@/lib/i18n';

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

const ANNOUNCEMENT_SWITCHES: {
  field: PreferenceField;
  key: 'prefs.inApp' | 'prefs.sms' | 'prefs.email';
}[] = [
  { field: 'announcements_in_app', key: 'prefs.inApp' },
  { field: 'announcements_sms', key: 'prefs.sms' },
  { field: 'announcements_email', key: 'prefs.email' },
];

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

  return (
    <Card>
      <CardHeader title={t('prefs.title', language)} subtitle={t('prefs.lead', language)} />
      <CardBody>
        {loadFailed ? (
          <Notice kind="error">
            <p className="small">{t('prefs.loadFailed', language)}</p>
          </Notice>
        ) : null}
        <fieldset style={{ border: 0, padding: 0, margin: 0, display: 'grid', gap: 8 }}>
          <legend className="label">{t('prefs.announcements', language)}</legend>
          {ANNOUNCEMENT_SWITCHES.map((s) => (
            <Checkbox
              key={s.field}
              label={t(s.key, language)}
              checked={shown[s.field]}
              disabled={!prefs || busy}
              onChange={(e) => set(s.field, e.target.checked)}
            />
          ))}
          {!emailAccount ? <p className="small muted">{t('prefs.emailNone', language)}</p> : null}
        </fieldset>
        <div style={{ marginTop: 12 }}>
          <Checkbox
            label={t('prefs.updates', language)}
            checked={shown.updates_in_app}
            disabled={!prefs || busy}
            onChange={(e) => set('updates_in_app', e.target.checked)}
          />
        </div>
        {/* 2026-10-26: match alerts (marketing; SMS off unless turned on). */}
        <fieldset style={{ border: 0, padding: 0, margin: '12px 0 0', display: 'grid', gap: 8 }}>
          <legend className="label">{t('prefs.match', language)}</legend>
          <Checkbox
            label={t('prefs.matchInApp', language)}
            checked={shown.match_in_app}
            disabled={!prefs || busy}
            onChange={(e) => set('match_in_app', e.target.checked)}
          />
          <Checkbox
            label={t('prefs.matchSms', language)}
            checked={shown.match_sms}
            disabled={!prefs || busy}
            onChange={(e) => set('match_sms', e.target.checked)}
          />
        </fieldset>
        {/* 2026-10-26: online status in conversations, reciprocal. */}
        <fieldset style={{ border: 0, padding: 0, margin: '12px 0 0', display: 'grid', gap: 8 }}>
          <legend className="label">{t('prefs.privacy', language)}</legend>
          <Checkbox
            label={t('prefs.showActivity', language)}
            checked={shown.show_activity}
            disabled={!prefs || busy}
            onChange={(e) => set('show_activity', e.target.checked)}
          />
          <p className="small muted">{t('prefs.showActivityHint', language)}</p>
        </fieldset>
        <Notice kind="info">
          <p className="small">{t('prefs.essential', language)}</p>
        </Notice>
        {state === 'saved' ? <Notice kind="success">{t('prefs.saved', language)}</Notice> : null}
        {state === 'failed' ? (
          <Notice kind="error">
            <p className="small">{t('prefs.failed', language)}</p>
          </Notice>
        ) : null}
        <div>
          <Button onClick={() => void save()} disabled={!prefs || busy}>
            {t('prefs.save', language)}
          </Button>
        </div>
      </CardBody>
    </Card>
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
