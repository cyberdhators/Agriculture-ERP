'use client';

import type { Language } from '@agri-erp/shared';

import { ensureAccount } from '../offline/outbox';

/**
 * PHONE ALERTS, THE PHONE'S SIDE (2026-11-04, the owner: no switch, "include it
 * as permission", for everyone). Once someone is signed in, an Allow / Not now
 * box appears (components/pwa/PushPermission.tsx), and Allow opens the phone's
 * own question. Found on the live site: asking at any first tap also followed
 * whatever was tapped, and then stayed silent for a week, so it has its own
 * button. Allowed, this phone gets alerts until sign-out or until blocked in its
 * settings. Not now asks again after a week. Blocked is said once.
 */

/** Which account, language and address the server already has for this phone. */
const SYNCED_KEY = 'agri-push-synced';
const ASKED_KEY = 'agri-push-box';
const BLOCKED_KEY = 'agri-push-blocked-told';
const WEEK_MS = 7 * 24 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

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
  return Number.isFinite(at) && at > 0 && Date.now() - at < WEEK_MS;
}

/** What the box should say. */
export type PushAsk = 'ask' | 'blocked' | 'install';

/**
 * Starts alerts for whoever is signed in on this phone, and says whether the box
 * has anything to ask. Never throws: alerts are never in the app's way.
 */
export async function startPush(): Promise<PushAsk | null> {
  try {
    if (!publicKey()) return null;
    const account = await ensureAccount();
    if (!account) return null;
    if (!canPush()) return iPhoneInBrowser() && !askedLately() ? 'install' : null;
    if (Notification.permission === 'granted') {
      await sync(account);
      return null;
    }
    if (Notification.permission === 'denied') return recall(BLOCKED_KEY) ? null : 'blocked';
    return askedLately() ? null : 'ask';
  } catch {
    return null;
  }
}

/** Allow, on the box: the phone's own question. Must be called directly from the tap. */
export async function allowPush(): Promise<void> {
  try {
    const answer = await Notification.requestPermission();
    // Closed without an answer: tomorrow, since Chrome blocks a site dismissed repeatedly.
    remember(ASKED_KEY, String(answer === 'default' ? Date.now() - WEEK_MS + DAY_MS : Date.now()));
    if (answer !== 'granted') return;
    const account = await ensureAccount();
    if (account) await sync(account);
  } catch {
    // The next time the app opens, a granted phone tries again.
  }
}

/** Not now, or OK on a box that only told them something. */
export function closePushBox(ask: PushAsk): void {
  if (ask === 'blocked') remember(BLOCKED_KEY, '1');
  else remember(ASKED_KEY, String(Date.now()));
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
