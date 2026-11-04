'use client';

import { useEffect, useState } from 'react';

import { Button } from '@/components/ui';
import { t, type Language } from '@/lib/i18n';
import { currentAccount, subscribeOutbox } from '@/lib/offline/outbox';
import { allowPush, closePushBox, startPush, type PushAsk } from '@/lib/push/client';

import css from './push-permission.module.css';

/**
 * Phone alerts as a permission (2026-11-04, the owner). Starts alerts when the
 * app opens and whenever a different account signs in; when the phone has not
 * been asked, or cannot say yes as it stands, a small box says so.
 */
export function PushPermission() {
  const [ask, setAsk] = useState<PushAsk | null>(null);
  const [language, setLanguage] = useState<Language>('en');

  useEffect(() => {
    let latest = 0;
    let last: string | null = null;
    // Finding the account can itself announce it, so an older start stands down.
    const start = () => {
      const mine = ++latest;
      void startPush().then((next) => {
        if (mine !== latest) return;
        setLanguage(document.documentElement.lang === 'ar' ? 'ar' : 'en');
        setAsk(next);
      });
    };
    start();
    const off = subscribeOutbox(() => {
      const now = currentAccount();
      if (now === last) return;
      last = now;
      if (now) start();
      else {
        latest += 1;
        setAsk(null);
      }
    });
    return () => {
      latest += 1;
      off();
    };
  }, []);

  if (!ask) return null;

  const close = () => {
    closePushBox(ask);
    setAsk(null);
  };

  return (
    <div className={`shop ${css.box}`} role="dialog" aria-labelledby="push-permission-title">
      <p id="push-permission-title" className={css.title}>
        {t(`push.${ask}.title`, language)}
      </p>
      <p className={css.body}>{t(`push.${ask}.body`, language)}</p>
      <div className={css.actions}>
        {ask === 'ask' ? (
          <>
            <Button variant="ghost" onClick={close}>
              {t('push.ask.later', language)}
            </Button>
            <Button
              onClick={() => {
                setAsk(null);
                void allowPush();
              }}
            >
              {t('push.ask.allow', language)}
            </Button>
          </>
        ) : (
          <Button onClick={close}>{t('push.ok', language)}</Button>
        )}
      </div>
    </div>
  );
}
