'use client';

import { useEffect, useRef } from 'react';

import type {
  MessageCreatedPayload,
  NotificationCreatedPayload,
  RealtimeChannels,
} from '@agri-erp/shared';

import { notificationsChanged } from '@/lib/farmer-unread';
import { messagesChanged } from '@/lib/messages/client';

/**
 * LIVE UPDATES, THE SCREEN'S SIDE (2026-10-26). docs/DECISIONS.md, "Bird
 * Realtime live updates".
 *
 * ONE CONNECTION PER TAB, opened by the first shell that mounts and shared by
 * everything else. It asks GET /api/realtime/channels what to subscribe to
 * (own account, organisation inboxes, own presence), and every private or
 * presence subscription is authorized one by one by POST /api/realtime/auth
 * with the session cookie -- the browser holds only the public app key
 * (NEXT_PUBLIC_BIRD_REALTIME_KEY) and the region.
 *
 * AN EVENT IS A NUDGE. It carries ids only; on one, the badges re-read their
 * counts (the same requests the minute timers make), open conversations
 * re-read their messages, and the live pop reads the notice by id. When
 * Realtime is not configured or the socket cannot connect, nothing changes:
 * every screen still polls exactly as before.
 */

export type LiveEvent =
  | { event: 'notification.created'; data: NotificationCreatedPayload }
  | { event: 'message.created'; data: MessageCreatedPayload };

export const LIVE_EVENT = 'agrione-live-event';

let starting: Promise<void> | null = null;
let me: string | null = null;
let connected = false;

/** The signed-in account's sign-in id, once the live connection knows it. */
export const liveMe = (): string | null => me;
export const liveConnected = (): boolean => connected;

function dispatch(e: LiveEvent): void {
  if (e.event === 'notification.created') notificationsChanged();
  else messagesChanged();
  window.dispatchEvent(new CustomEvent<LiveEvent>(LIVE_EVENT, { detail: e }));
}

async function authorize({
  connectionId,
  channelName,
}: {
  connectionId: string;
  channelName: string;
}): Promise<{ auth: string; member_data?: string }> {
  const res = await fetch('/api/realtime/auth', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ connection_id: connectionId, channel_name: channelName }),
    cache: 'no-store',
  });
  const body = (await res.json().catch(() => ({}))) as {
    data?: { auth: string; member_data?: string };
  };
  if (!res.ok || !body.data?.auth) throw new Error(`Live channel refused (${res.status}).`);
  return body.data;
}

async function start(): Promise<void> {
  const appKey = process.env.NEXT_PUBLIC_BIRD_REALTIME_KEY;
  const region = process.env.NEXT_PUBLIC_BIRD_REALTIME_REGION;
  if (!appKey || !region || typeof WebSocket === 'undefined') return;
  const res = await fetch('/api/realtime/channels', { cache: 'no-store' }).catch(() => null);
  if (!res?.ok) return;
  const body = (await res.json().catch(() => ({}))) as { data?: RealtimeChannels };
  const plan = body.data;
  if (!plan?.enabled || plan.channels.length === 0) return;
  me = plan.me;
  // Loaded only when live updates are on, so pages without them carry none of it.
  const { BirdRealtime } = await import('@messagebird/realtime');
  const bird = new BirdRealtime({ appKey, region, authorizer: authorize });
  bird.connection.bind<{ current: string }>('state_change', ({ current }) => {
    connected = current === 'connected';
  });
  for (const name of plan.channels) {
    const channel = bird.subscribe(name);
    if (name.startsWith('presence-')) continue;
    channel.bind<NotificationCreatedPayload>('notification.created', (data) =>
      dispatch({ event: 'notification.created', data }),
    );
    channel.bind<MessageCreatedPayload>('message.created', (data) =>
      dispatch({ event: 'message.created', data }),
    );
  }
}

/**
 * 2026-11-01: tells the server the moment the app is closed or hidden, so
 * "Active ... ago" is exact (POST /api/account/presence/bye; the server keeps
 * at most one per account per 30 seconds). A beacon, which survives the page
 * closing; a keep-alive request where beacons are missing. Best effort.
 */
const BYE_URL = '/api/account/presence/bye';

function sayBye(): void {
  try {
    const body = new Blob(['{}'], { type: 'application/json' });
    if (navigator.sendBeacon?.(BYE_URL, body)) return;
    void fetch(BYE_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{}',
      keepalive: true,
    }).catch(() => undefined);
  } catch {
    // Nothing to do: the five-minute activity stamp still stands.
  }
}

function watchBye(): void {
  window.addEventListener('pagehide', sayBye);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') sayBye();
  });
}

/** Opens the tab's live connection once. Safe to call from every shell. */
export function startLive(): void {
  if (typeof window === 'undefined' || starting) return;
  watchBye();
  starting = start().catch(() => {
    // No live updates this time; polling carries on. A later page load retries.
  });
}

/** Calls `handler` for every live event while the component is mounted. */
export function useLiveEvent(handler: (e: LiveEvent) => void): void {
  const ref = useRef(handler);
  ref.current = handler;
  useEffect(() => {
    const on = (e: Event) => ref.current((e as CustomEvent<LiveEvent>).detail);
    window.addEventListener(LIVE_EVENT, on);
    return () => window.removeEventListener(LIVE_EVENT, on);
  }, []);
}
