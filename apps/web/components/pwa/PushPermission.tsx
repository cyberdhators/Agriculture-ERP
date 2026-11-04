'use client';

import { useEffect } from 'react';

import { currentAccount, subscribeOutbox } from '@/lib/offline/outbox';
import { startPush } from '@/lib/push/client';

/**
 * Phone alerts as a permission (2026-11-04, the owner). Shows nothing itself: it
 * starts alerts when the app opens, and again whenever a different account signs
 * in. The only thing a person sees is the browser's or the phone's own question.
 */
export function PushPermission() {
  useEffect(() => {
    let last: string | null = null;
    void startPush();
    return subscribeOutbox(() => {
      const now = currentAccount();
      if (now === last) return;
      last = now;
      if (now) void startPush();
    });
  }, []);
  return null;
}
