'use client';

import { useEffect, useState } from 'react';

import { farmerApi } from '@/lib/farmer-session';
import { offlineNow } from '@/lib/offline/net';

/**
 * HOW MANY OF THE FARMER'S NOTICES ARE UNREAD (2026-10-10), for the red badge
 * on the bell. CORWADO's review: "It has to show a red sign on the
 * notification bell once an order is placed."
 *
 * One count shared by every bell on the screen (the masthead and the side
 * menu): read when the first appears, every minute, when the app comes back
 * to the front, and when the notifications page has marked them read.
 */

const CHANGED = 'agrione-notifications-changed';
const listeners = new Set<(n: number) => void>();
let count = 0;
let timer: ReturnType<typeof setInterval> | null = null;

async function load(): Promise<void> {
  if (offlineNow()) return;
  try {
    const rows = await farmerApi<{ read_at: string | null }[]>('/api/farmer/notifications');
    count = rows.filter((r) => !r.read_at).length;
    for (const l of listeners) l(count);
  } catch {
    // No answer: keep the last count.
  }
}

const onVisible = () => {
  if (document.visibilityState === 'visible') void load();
};
const onChanged = () => void load();

/** Tell the bells that notices were read (or arrived) so they read the count again. */
export function notificationsChanged(): void {
  if (typeof window !== 'undefined') window.dispatchEvent(new Event(CHANGED));
}

export function useUnreadNotifications(enabled: boolean): number {
  const [n, setN] = useState(count);
  useEffect(() => {
    if (!enabled) return;
    listeners.add(setN);
    if (listeners.size === 1) {
      void load();
      timer = setInterval(() => void load(), 60_000);
      document.addEventListener('visibilitychange', onVisible);
      window.addEventListener(CHANGED, onChanged);
    } else {
      setN(count);
    }
    return () => {
      listeners.delete(setN);
      if (listeners.size === 0) {
        if (timer) clearInterval(timer);
        timer = null;
        document.removeEventListener('visibilitychange', onVisible);
        window.removeEventListener(CHANGED, onChanged);
      }
    };
  }, [enabled]);
  return enabled ? n : 0;
}
