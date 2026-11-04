'use client';

import type { Language } from '@agri-erp/shared';

import { ensureAccount } from '../offline/outbox';

/**
 * PHONE ALERTS, THE PHONE'S SIDE (2026-11-04, the owner: "only pop up is allow
 * this site to send notification, after apk, it should be allow app"). The app
 * shows nothing of its own: once someone is signed in, the browser's own question
 * opens by itself. In the Android app built from this site, the same call brings
 * up the phone's own question for the app. Allowed, this phone gets alerts until
 * sign-out or until blocked in its settings. Unanswered, it asks again the next
 * day, because Chrome blocks a site whose question is dismissed repeatedly.
 * Blocked, it says nothing.
 */

/** Which account, language and address the server already has for this phone. */
const SYNCED_KEY = 'agri-push-synced';
const ASKED_KEY = 'agri-push-asked-at';
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

/** An iPhone only opens the question from a tap. */
const needsTap = () => /iPhone|iPad|iPod/.test(navigator.userAgent);

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
  return Number.isFinite(at) && at > 0 && Date.now() - at < DAY_MS;
}

async function ask(): Promise<void> {
  try {
    const answer = await Notification.requestPermission();
    if (answer !== 'granted') return;
    const account = await ensureAccount();
    if (account) await sync(account);
  } catch {
    // The next time the app opens, a phone that allowed it tries again.
  }
}

/**
 * Starts alerts for whoever is signed in on this phone. Never throws: alerts are
 * never in the app's way.
 */
export async function startPush(): Promise<void> {
  try {
    if (!publicKey() || !canPush() || Notification.permission === 'denied') return;
    const account = await ensureAccount();
    if (!account) return;
    if (Notification.permission === 'granted') {
      await sync(account);
      return;
    }
    if (askedLately()) return;
    remember(ASKED_KEY, String(Date.now()));
    if (needsTap()) document.addEventListener('click', () => void ask(), { once: true });
    else await ask();
  } catch {
    // Nothing shows, and the next time the app opens it tries again.
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
