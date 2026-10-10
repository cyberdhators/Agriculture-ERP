'use client';

import {
  createContext,
  createElement,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';

import { farmerAuthIdentifier } from '@agri-erp/shared';

import { DEFAULT_LANGUAGE, LANG_COOKIE, LANG_STORAGE, isLanguage, type Language } from '@/lib/i18n';
import type { Farmer, ProduceListing } from '@/lib/fixtures/farmers';
import { enqueue, queuedOf, subscribeOutbox } from '@/lib/offline/outbox';
import { loadWithSnapshot, readSnapshot, saveSnapshot } from '@/lib/offline/snapshot';
import { supabaseBrowser } from '@/lib/supabase/browser';

/**
 * THE FARMER'S SESSION -- REAL SINCE B14 (2026-10-07).
 *
 * This file used to be a browser-only stand-in: fixture farmers, a cookie
 * holding an id, listings kept in React state, nothing saved. Farmers now hold
 * accounts (DECISIONS, "Farmers enrol themselves and deal with buyers
 * directly"), so the same interface is backed by the real thing:
 *
 *   - sign-in is Supabase Auth, phone + password, through the one derived
 *     identifier (`farmerAuthIdentifier`), exactly as an officer's is;
 *   - the farmer is GET /api/farmer/me, which requireRole resolves from the
 *     session; nothing about who is signed in is decided in the browser;
 *   - listings are /api/farmer/listings, owned by the session's farmer.
 *
 * The language choice is still a cookie and local storage: a preference, not
 * a record. The screens read the same hook as before; where an action now
 * waits on the network, it returns a promise.
 */

function readCookie(name: string): string | null {
  if (typeof document === 'undefined') return null;
  const match = document.cookie.match(new RegExp(`(?:^|; )${name}=([^;]*)`));
  return match ? decodeURIComponent(match[1]!) : null;
}

function writeCookie(name: string, value: string): void {
  if (typeof document === 'undefined') return;
  document.cookie = `${name}=${encodeURIComponent(value)}; path=/; max-age=31536000; samesite=lax`;
}

/** What self-registration sends: POST /api/farmer/register's body. */
export type FarmerRegistration = Record<string, unknown> & { phone: string; password: string };

/** Why a sign-in or a password/phone change did not go through. */
export type AuthFailure = 'wrong' | 'locked' | 'unavailable';

/** The farmer as GET /api/farmer/me returns them, in the shape the screens read. */
type MeResponse = Farmer & {
  payam_name?: string;
  village?: string | null;
  primary_crops?: string[];
  preferred_language?: string | null;
};

export class FarmerApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly fields: Record<string, string> = {},
  ) {
    super(message);
    this.name = 'FarmerApiError';
  }
}

/** One call to a farmer route. Errors keep the server's own sentence and field reasons. */
export async function farmerApi<T>(path: string, init: RequestInit = {}): Promise<T> {
  let response: Response;
  try {
    response = await fetch(path, {
      ...init,
      headers: init.body ? { 'content-type': 'application/json', ...init.headers } : init.headers,
    });
  } catch {
    throw new FarmerApiError(
      0,
      'network',
      'The server could not be reached. Check the connection.',
    );
  }
  const body = (await response.json().catch(() => ({}))) as {
    data?: T;
    error?: { code: string; message: string; fields?: Record<string, string> };
  };
  if (!response.ok) {
    throw new FarmerApiError(
      response.status,
      body.error?.code ?? 'unknown',
      body.error?.message ?? `The request failed (${response.status}).`,
      body.error?.fields ?? {},
    );
  }
  return body.data as T;
}

interface FarmerSessionValue {
  hydrated: boolean;
  language: Language;
  setLanguage: (lang: Language) => void;

  /** The signed-in farmer, or null. `(farmer)/account/**` redirects when null. */
  farmer: MeResponse | null;
  /** Reload the farmer and their listings from the server. */
  refresh: () => Promise<void>;
  signIn: (
    phone: string,
    password: string,
  ) => Promise<{ ok: true } | { ok: false; reason: AuthFailure }>;
  /** Registers, then signs in. Throws FarmerApiError with field reasons on refusal. */
  register: (input: FarmerRegistration) => Promise<{ farmer_number: string }>;
  signOut: () => Promise<void>;
  changePassword: (current: string, next: string) => Promise<boolean>;
  changePhone: (password: string, phone: string) => Promise<boolean>;

  listingsFor: (farmerId: string) => ProduceListing[];
  listingById: (id: string) => ProduceListing | undefined;
  /** Creates or updates one of the farmer's own listings on the server. */
  saveListing: (listing: ProduceListing) => Promise<ProduceListing>;
  newListingId: () => string;
  /** PWA (2026-10-10): saved on this phone, not yet on the server. */
  isPending: (listingId: string) => boolean;
  /** The farmer's details came from this phone (no signal), saved at this time. */
  offlineSince: number | null;
}

const FarmerSessionContext = createContext<FarmerSessionValue | null>(null);

/** Fields a listing carries that the server owns, never sent back. */
const SERVER_OWNED = new Set(['farmer_id', 'created_at', 'updated_at', 'photo_storage_paths']);

export function FarmerSessionProvider({
  initialLanguage = DEFAULT_LANGUAGE,
  children,
}: {
  initialLanguage?: Language;
  children: ReactNode;
}) {
  const [hydrated, setHydrated] = useState(false);
  const [language, setLanguageState] = useState<Language>(initialLanguage);
  const [farmer, setFarmer] = useState<MeResponse | null>(null);
  const [listings, setListings] = useState<ProduceListing[]>([]);
  /** Ids of listings the server has (from the last answer or saved copy). */
  const [serverIds, setServerIds] = useState<ReadonlySet<string>>(new Set());
  const [pending, setPending] = useState<ReadonlySet<string>>(new Set());
  const [offlineSince, setOfflineSince] = useState<number | null>(null);

  /**
   * PWA (2026-10-10): the server's listings, with this phone's unsent changes
   * laid over them -- an offline new listing is added, an offline edit
   * replaces the server copy -- so the farmer sees what they did at once.
   */
  const withPending = useCallback(async (fromServer: ProduceListing[], farmerId: string) => {
    const queued = await queuedOf('listing');
    const byId = new Map(fromServer.map((l) => [l.id, l]));
    const ids = new Set<string>();
    for (const q of queued) {
      const body = (q.body ?? {}) as Partial<ProduceListing>;
      const id = q.id.replace(/^listing:/, '');
      ids.add(id);
      const base = byId.get(id);
      const now = new Date(q.createdAt).toISOString();
      byId.set(id, {
        ...(base ?? ({ created_at: now, photo_storage_paths: [] } as unknown as ProduceListing)),
        ...body,
        id,
        farmer_id: farmerId,
        updated_at: now,
      } as ProduceListing);
    }
    setPending(ids);
    return [...byId.values()];
  }, []);

  const load = useCallback(async () => {
    // Only "no signal" falls back to this phone's copy: signed out or not a
    // farmer is a real answer, never papered over by an old copy.
    const noSignal = (e: unknown) => e instanceof FarmerApiError && e.status === 0;
    try {
      const me = await loadWithSnapshot(
        'farmer.me',
        () => farmerApi<MeResponse>('/api/farmer/me'),
        noSignal,
      );
      if (!me) throw new Error('no farmer');
      setFarmer(me.data);
      setOfflineSince(me.fresh ? null : me.savedAt);
      const mine = await loadWithSnapshot(
        'farmer.listings',
        () => farmerApi<ProduceListing[]>('/api/farmer/listings'),
        noSignal,
      ).catch(() => readSnapshot<ProduceListing[]>('farmer.listings'));
      const fromServer = mine?.data ?? [];
      setServerIds(new Set(fromServer.map((l) => l.id)));
      setListings(await withPending(fromServer, me.data.id));
    } catch {
      // 401: nobody signed in. 403: signed in, but not as a farmer (staff or
      // a buyer browsing the market). Either way there is no farmer here.
      setFarmer(null);
      setListings([]);
      setOfflineSince(null);
    }
  }, [withPending]);

  // When the outbox sends a listing, reload so the screen shows the server's copy.
  useEffect(() => {
    let before = -1;
    return subscribeOutbox(() => {
      void queuedOf('listing').then((q) => {
        if (before >= 0 && q.length < before) void load();
        before = q.length;
      });
    });
  }, [load]);

  useEffect(() => {
    const storedLang = (() => {
      try {
        return window.localStorage.getItem(LANG_STORAGE);
      } catch {
        return null;
      }
    })();
    const lang = [storedLang, readCookie(LANG_COOKIE)].find(isLanguage);
    if (lang) setLanguageState(lang);
    void load().finally(() => setHydrated(true));
  }, [load]);

  const setLanguage = useCallback((lang: Language) => {
    setLanguageState(lang);
    writeCookie(LANG_COOKIE, lang);
    try {
      window.localStorage.setItem(LANG_STORAGE, lang);
    } catch {
      // Private window: the cookie still carries the choice.
    }
  }, []);

  const signIn = useCallback<FarmerSessionValue['signIn']>(
    async (phone, password) => {
      let identifier: string;
      try {
        identifier = farmerAuthIdentifier(phone);
      } catch {
        return { ok: false, reason: 'wrong' };
      }
      try {
        const { error } = await supabaseBrowser().auth.signInWithPassword({
          email: identifier,
          password,
        });
        if (error) {
          if (error.status === 429) return { ok: false, reason: 'locked' };
          const refused = error.status !== undefined && [400, 401, 403, 404].includes(error.status);
          return { ok: false, reason: refused ? 'wrong' : 'unavailable' };
        }
      } catch {
        return { ok: false, reason: 'unavailable' };
      }
      await load();
      return { ok: true };
    },
    [load],
  );

  const register = useCallback<FarmerSessionValue['register']>(
    async (input) => {
      let created: { farmer_number: string };
      try {
        created = await farmerApi<{ farmer_number: string }>('/api/farmer/register', {
          method: 'POST',
          body: JSON.stringify(input),
          // At most 45 seconds (2026-10-08): the account was sometimes saved
          // while the answer never reached the browser.
          signal: AbortSignal.timeout(45_000),
        });
      } catch (error) {
        // No answer: the account may exist anyway. Signing in settles it.
        if (error instanceof FarmerApiError && error.status === 0) {
          const outcome = await signIn(input.phone, input.password);
          if (outcome.ok) {
            const me = await farmerApi<{ farmer_number: string }>('/api/farmer/me');
            return { farmer_number: me.farmer_number };
          }
          throw new FarmerApiError(
            0,
            'network',
            'The server took too long to answer and your registration was not confirmed. Please try again in a moment.',
          );
        }
        throw error;
      }
      await signIn(input.phone, input.password);
      return created;
    },
    [signIn],
  );

  const signOut = useCallback(async () => {
    await supabaseBrowser()
      .auth.signOut()
      .catch(() => undefined);
    setFarmer(null);
    setListings([]);
  }, []);

  /** The password is checked by signing in with it, which the auth service does. */
  const passwordIsRight = useCallback(
    async (password: string) => {
      if (!farmer) return false;
      const { error } = await supabaseBrowser().auth.signInWithPassword({
        email: farmerAuthIdentifier(farmer.phone),
        password,
      });
      return !error;
    },
    [farmer],
  );

  const changePassword = useCallback<FarmerSessionValue['changePassword']>(
    async (current, next) => {
      if (!(await passwordIsRight(current))) return false;
      const { error } = await supabaseBrowser().auth.updateUser({ password: next });
      return !error;
    },
    [passwordIsRight],
  );

  const changePhone = useCallback<FarmerSessionValue['changePhone']>(
    async (password, phone) => {
      if (!(await passwordIsRight(password))) return false;
      try {
        await farmerApi('/api/farmer/me', { method: 'PATCH', body: JSON.stringify({ phone }) });
      } catch {
        return false;
      }
      await load();
      return true;
    },
    [passwordIsRight, load],
  );

  const listingsFor = useCallback(
    (farmerId: string) =>
      listings
        .filter((l) => l.farmer_id === farmerId)
        .sort((a, b) => b.updated_at.localeCompare(a.updated_at)),
    [listings],
  );

  const listingById = useCallback((id: string) => listings.find((l) => l.id === id), [listings]);

  const saveListing = useCallback<FarmerSessionValue['saveListing']>(
    async (listing) => {
      // The server knows it only once a create has been acknowledged. A listing
      // made offline and edited again before it was sent is still a create.
      const onServer = serverIds.has(listing.id);
      const body = Object.fromEntries(
        Object.entries(listing).filter(([k, v]) => !SERVER_OWNED.has(k) && v !== undefined),
      );
      if (onServer) delete (body as Record<string, unknown>).id;
      const path = onServer ? `/api/farmer/listings/${listing.id}` : '/api/farmer/listings';
      const method = onServer ? 'PATCH' : 'POST';

      const queue = async () => {
        await enqueue({
          id: `listing:${listing.id}`,
          kind: 'listing',
          label: `${onServer ? 'Edit' : 'Post'}: ${listing.title}`,
          method,
          path,
          body,
        });
        const local = { ...listing, updated_at: new Date().toISOString() };
        setPending((p) => new Set(p).add(listing.id));
        setListings((list) =>
          list.some((l) => l.id === listing.id)
            ? list.map((l) => (l.id === listing.id ? local : l))
            : [local, ...list],
        );
        // Marked so the caller knows it is on the phone, not yet on the server.
        return Object.assign(local, { pending: true as const });
      };

      // No signal: save on the phone; the outbox sends it later.
      if (typeof navigator !== 'undefined' && !navigator.onLine) return queue();
      try {
        const saved = await farmerApi<ProduceListing>(path, { method, body: JSON.stringify(body) });
        setServerIds((ids) => new Set(ids).add(saved.id));
        setListings((list) =>
          list.some((l) => l.id === saved.id)
            ? list.map((l) => (l.id === saved.id ? saved : l))
            : [saved, ...list],
        );
        const copy = await readSnapshot<ProduceListing[]>('farmer.listings');
        const rest = (copy?.data ?? []).filter((l) => l.id !== saved.id);
        await saveSnapshot('farmer.listings', [saved, ...rest]);
        return saved;
      } catch (error) {
        // The signal dropped mid-save: keep it on the phone. A real refusal
        // (invalid, not allowed) is shown to the farmer as before.
        if (error instanceof FarmerApiError && error.status === 0) return queue();
        throw error;
      }
    },
    [serverIds],
  );

  const isPending = useCallback((id: string) => pending.has(id), [pending]);

  const newListingId = useCallback(
    () =>
      typeof crypto !== 'undefined' && 'randomUUID' in crypto
        ? crypto.randomUUID()
        : `00000000-0000-4000-8000-${Date.now().toString(16).padStart(12, '0').slice(-12)}`,
    [],
  );

  const value = useMemo<FarmerSessionValue>(
    () => ({
      hydrated,
      language,
      setLanguage,
      farmer,
      refresh: load,
      signIn,
      register,
      signOut,
      changePassword,
      changePhone,
      listingsFor,
      listingById,
      saveListing,
      newListingId,
      isPending,
      offlineSince,
    }),
    [
      hydrated,
      language,
      setLanguage,
      farmer,
      load,
      signIn,
      register,
      signOut,
      changePassword,
      changePhone,
      listingsFor,
      listingById,
      saveListing,
      newListingId,
      isPending,
      offlineSince,
    ],
  );

  return createElement(FarmerSessionContext.Provider, { value }, children);
}

export function useFarmerSession(): FarmerSessionValue {
  const ctx = useContext(FarmerSessionContext);
  if (!ctx) throw new Error('useFarmerSession must be used inside FarmerSessionProvider');
  return ctx;
}
