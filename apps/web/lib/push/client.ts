'use client';

import type { Language } from '@agri-erp/shared';

import { ensureAccount } from '../offline/outbox';

/**
 * PHONE ALERTS, THE PHONE'S SIDE (2026-11-04, the owner: no switch, "include it
 * as permission", for everyone). Once someone is signed in, the phone's own
 * permission question appears at their first tap: browsers refuse or quieten
 * one that opens by itself. Allowed, this phone gets alerts until they sign out
 * or block them in the phone's settings. Dismissed, it asks again after a week.
 * Blocked, it never asks. Nothing here shows on screen, or gets in anyone's way.
 */

/** Which account, language and address the server already has for this phone. */
const SYNCED_KEY = 'agri-push-synced';
const ASKED_KEY = 'agri-push-asked';
const ASK_AGAIN_MS = 7 * 24 * 60 * 60 * 1000;

const publicKey = () => process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY ?? '';

const remember = (key: string, value: string | null) => {
  try {
    if (value) localStorage.setItem(key, value);
    else localStorage.removeItem(key);
  } catch {
    // Storage blocked: the server is told again next time, which is harmless.
  }
};

const recall = (key: string) => {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
};

function canPush(): boolean {
  return 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
}

const bytesOf = (base64url: string): Uint8Array<ArrayBuffer> => {
  const padded = base64url.padEnd(base64url.length + ((4 - (base64url.length % 4)) % 4), '=');
  const raw = atob(padded.replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
};

async function post(path: string, body: unknown): Promise<void> {
  const res = await fetch(path, {
    method: 'POST',
    cache: 'no-store',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(String(res.status));
}

/** Tells the server about this phone when anything changed; a failure tries again next load. */
async function sync(account: string): Promise<void> {
  const registration = await navigator.serviceWorker.ready;
  const subscription =
    (await registration.pushManager.getSubscription()) ??
    (await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: bytesOf(publicKey()),
    }));
  const language: Language = document.documentElement.lang === 'ar' ? 'ar' : 'en';
  const { endpoint, keys } = subscription.toJSON();
  const state = `${account}|${language}|${endpoint}`;
  if (recall(SYNCED_KEY) === state) return;
  await post('/api/account/push-subscription', { endpoint, keys, language });
  remember(SYNCED_KEY, state);
}

function askedLately(): boolean {
  const at = Number(recall(ASKED_KEY));
  return Number.isFinite(at) && at > 0 && Date.now() - at < ASK_AGAIN_MS;
}

/**
 * Starts alerts for whoever is signed in on this phone. Returns how to stop
 * waiting for the first tap. Never throws: alerts are never in the app's way.
 */
export async function startPush(): Promise<() => void> {
  const nothing = () => undefined;
  try {
    if (!publicKey() || !canPush() || Notification.permission === 'denied') return nothing;
    const account = await ensureAccount();
    if (!account) return nothing;
    if (Notification.permission === 'granted') {
      await sync(account);
      return nothing;
    }
    if (askedLately()) return nothing;
    const onTap = () => {
      document.removeEventListener('click', onTap, true);
      remember(ASKED_KEY, String(Date.now()));
      // Called directly inside the tap, which is what the browser requires.
      void Notification.requestPermission()
        .then((answer) => (answer === 'granted' ? sync(account) : undefined))
        .catch(() => undefined);
    };
    document.addEventListener('click', onTap, true);
    return () => document.removeEventListener('click', onTap, true);
  } catch {
    return nothing;
  }
}

/**
 * Stops alerts on this phone at sign-out. The browser's side goes first, so it
 * holds with no signal; the service's next refusal then clears the server's row
 * if the request below did not get through. Never throws, and never holds up a
 * sign-out.
 */
export async function stopPushOnThisPhone(): Promise<void> {
  remember(SYNCED_KEY, null);
  try {
    if (!canPush()) return;
    const registration = await navigator.serviceWorker.getRegistration();
    const subscription = await registration?.pushManager.getSubscription();
    if (!subscription) return;
    const { endpoint } = subscription;
    await subscription.unsubscribe();
    await post('/api/account/push-subscription/remove', { endpoint });
  } catch {
    // No signal, or already signed out: see above.
  }
}
