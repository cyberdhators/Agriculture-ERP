'use client';

import { useEffect } from 'react';

import { currentAccount, subscribeOutbox } from '@/lib/offline/outbox';
import { startPush } from '@/lib/push/client';

/**
 * Phone alerts as a permission (2026-11-04, the owner). Shows nothing: it starts
 * alerts when the app opens, and again whenever a different account signs in.
 */
export function PushPermission() {
  useEffect(() => {
    let stopWaiting = () => {};
    let last: string | null = null;
    let live = true;
    let latest = 0;
    // Finding the account can itself announce it, so an older start stands down.
    const start = () => {
      const mine = ++latest;
      stopWaiting();
      void startPush().then((stop) => {
        if (live && mine === latest) stopWaiting = stop;
        else stop();
      });
    };
    start();
    const off = subscribeOutbox(() => {
      const now = currentAccount();
      if (now === last) return;
      last = now;
      if (now) start();
      else stopWaiting();
    });
    return () => {
      live = false;
      off();
      stopWaiting();
    };
  }, []);
  return null;
}
