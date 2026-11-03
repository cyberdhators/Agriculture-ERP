'use client';

import type { Language } from '@agri-erp/shared';

import { currentAccount } from '../offline/outbox';

/**
 * PHONE ALERTS, THE PHONE'S SIDE (2026-11-03). The browser asks for permission
 * only when someone turns the switch on, never on opening a page. Which account
 * turned them on is remembered here, so the next person signed in on a shared
 * phone sees the switch off rather than someone else's choice.
 */

const OWNER_KEY = 'agri-push-account';
const LANGUAGE_KEY = 'agri-push-language';

const publicKey = () => process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY ?? '';

export type PushState = 'hidden' | 'install' | 'blocked' | 'off' | 'on';

const remember = (key: string, value: string | null) => {
  try {
    if (value) localStorage.setItem(key, value);
    else localStorage.removeItem(key);
  } catch {
    // Storage blocked: the switch shows off next time, and turning it on is harmless.
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

/** An iPhone only offers alerts once AgriOne is on the home screen. */
function iPhoneInBrowser(): boolean {
  return (
    /iPhone|iPad|iPod/.test(navigator.userAgent) &&
    !window.matchMedia('(display-mode: standalone)').matches
  );
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

const browserSubscription = async () =>
  (await navigator.serviceWorker.ready).pushManager.getSubscription();

function bodyOf(subscription: PushSubscription, language: Language) {
  const { endpoint, keys } = subscription.toJSON();
  return { endpoint, keys, language };
}

export async function pushState(language: Language): Promise<PushState> {
  if (!publicKey()) return 'hidden';
  if (!canPush()) return iPhoneInBrowser() ? 'install' : 'hidden';
  if (Notification.permission === 'denied') return 'blocked';
  if (Notification.permission !== 'granted') return 'off';
  const subscription = await browserSubscription();
  const account = currentAccount();
  if (!subscription || !account || recall(OWNER_KEY) !== account) return 'off';
  // The language changed since: alerts follow it.
  if (recall(LANGUAGE_KEY) !== language) {
    await post('/api/account/push-subscription', bodyOf(subscription, language)).then(
      () => remember(LANGUAGE_KEY, language),
      () => undefined,
    );
  }
  return 'on';
}

export async function turnPushOn(language: Language): Promise<PushState> {
  const permission = await Notification.requestPermission();
  if (permission !== 'granted') return permission === 'denied' ? 'blocked' : 'off';
  const registration = await navigator.serviceWorker.ready;
  const subscription =
    (await registration.pushManager.getSubscription()) ??
    (await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: bytesOf(publicKey()),
    }));
  await post('/api/account/push-subscription', bodyOf(subscription, language));
  remember(OWNER_KEY, currentAccount());
  remember(LANGUAGE_KEY, language);
  return 'on';
}

/**
 * Stops alerts on this phone: the switch, and signing out. The browser's side
 * goes first, so it holds with no signal; the service's next refusal then
 * clears the server's row if the request below did not get through. Never
 * throws, and never holds up a sign-out.
 */
export async function stopPushOnThisPhone(): Promise<void> {
  remember(OWNER_KEY, null);
  remember(LANGUAGE_KEY, null);
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
