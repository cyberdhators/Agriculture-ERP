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

import { DEFAULT_LANGUAGE, LANG_COOKIE, LANG_STORAGE, isLanguage, type Language } from '@/lib/i18n';
import {
  FARMERS,
  LISTINGS,
  farmerByPhone,
  type ConsentLanguage,
  type Farmer,
  type ProduceListing,
} from '@/lib/fixtures/farmers';

/**
 * PREVIEW — REPLACED BY THE B12 SESSION.
 *
 * Everything the real farmer flow gets from the server is stubbed here so the
 * screens can be walked end to end: the chosen language (a cookie the layout
 * reads and localStorage so it survives a return), the signed-in farmer (the
 * cookie `farmer_session` carries a fixture farmer id), self-registrations held
 * in client state for the session, and produce listings held the same way.
 * Nothing is written anywhere. When B12 lands — phone + SMS code auth, a real
 * `farmer` principal, the `produce_listing` table — this file is deleted and
 * the screens fetch instead, unchanged.
 */

export const SESSION_COOKIE = 'farmer_session';

function readCookie(name: string): string | null {
  if (typeof document === 'undefined') return null;
  const match = document.cookie.match(new RegExp(`(?:^|; )${name}=([^;]*)`));
  return match ? decodeURIComponent(match[1]!) : null;
}

function writeCookie(name: string, value: string): void {
  if (typeof document === 'undefined') return;
  // A year, path-wide; a preview cookie, not a security token.
  document.cookie = `${name}=${encodeURIComponent(value)}; path=/; max-age=31536000; samesite=lax`;
}

function clearCookie(name: string): void {
  if (typeof document === 'undefined') return;
  document.cookie = `${name}=; path=/; max-age=0; samesite=lax`;
}

/** The fields a self-registration supplies; the rest are filled in as pending. */
export interface FarmerRegistration {
  given_name: string;
  family_name: string;
  sex: 'f' | 'm';
  year_of_birth: number;
  phone: string;
  payam_id: string;
  state_id: string;
  preferred_language: ConsentLanguage;
  consent_version: string;
}

interface FarmerSessionValue {
  hydrated: boolean;
  language: Language;
  setLanguage: (lang: Language) => void;

  /** The signed-in farmer, or null. `(farmer)/account/**` redirects when null. */
  farmer: Farmer | null;
  signIn: (farmerId: string) => void;
  register: (input: FarmerRegistration) => Farmer;
  signOut: () => void;

  listingsFor: (farmerId: string) => ProduceListing[];
  listingById: (id: string) => ProduceListing | undefined;
  saveListing: (listing: ProduceListing) => void;
  newListingId: () => string;
}

const FarmerSessionContext = createContext<FarmerSessionValue | null>(null);

const SELF_PREFIX = 'CE-JUB';

function makeSelfFarmer(input: FarmerRegistration, id: string): Farmer {
  const now = new Date().toISOString();
  return {
    id,
    // Pending: no farmer number is assigned until an officer verifies (C-5).
    farmer_number: `${SELF_PREFIX}-pending`,
    given_name: input.given_name,
    family_name: input.family_name,
    sex: input.sex,
    year_of_birth: input.year_of_birth,
    phone: input.phone,
    national_id: null,
    payam_id: input.payam_id,
    state_id: input.state_id,
    registered_by: null,
    registration_source: 'self',
    verification_status: 'pending',
    merged_into: null,
    consent_id: `consent-${id}`,
    created_at: now,
    preferred_language: input.preferred_language,
  };
}

export function FarmerSessionProvider({
  initialLanguage = DEFAULT_LANGUAGE,
  children,
}: {
  initialLanguage?: Language;
  children: ReactNode;
}) {
  const [hydrated, setHydrated] = useState(false);
  const [language, setLanguageState] = useState<Language>(initialLanguage);
  const [selfFarmers, setSelfFarmers] = useState<Farmer[]>([]);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [listings, setListings] = useState<ProduceListing[]>(() => [...LISTINGS]);

  // Read the persisted choices once, client-side, so SSR and first paint agree.
  useEffect(() => {
    const storedLang = (() => {
      try {
        return window.localStorage.getItem(LANG_STORAGE);
      } catch {
        return null;
      }
    })();
    const cookieLang = readCookie(LANG_COOKIE);
    const lang = [storedLang, cookieLang].find(isLanguage);
    if (lang) setLanguageState(lang);
    setSessionId(readCookie(SESSION_COOKIE));
    setHydrated(true);
  }, []);

  const setLanguage = useCallback((lang: Language) => {
    setLanguageState(lang);
    writeCookie(LANG_COOKIE, lang);
    try {
      window.localStorage.setItem(LANG_STORAGE, lang);
    } catch {
      // Private window: the choice still holds for this session via the cookie.
    }
  }, []);

  const allFarmers = useMemo<readonly Farmer[]>(() => [...selfFarmers, ...FARMERS], [selfFarmers]);

  const farmer = useMemo(
    () => (sessionId ? (allFarmers.find((f) => f.id === sessionId) ?? null) : null),
    [sessionId, allFarmers],
  );

  const signIn = useCallback((farmerId: string) => {
    setSessionId(farmerId);
    writeCookie(SESSION_COOKIE, farmerId);
  }, []);

  const register = useCallback((input: FarmerRegistration) => {
    const id =
      typeof crypto !== 'undefined' && 'randomUUID' in crypto
        ? crypto.randomUUID()
        : `self-${Date.now()}`;
    const created = makeSelfFarmer(input, id);
    setSelfFarmers((list) => [created, ...list]);
    setSessionId(id);
    writeCookie(SESSION_COOKIE, id);
    return created;
  }, []);

  const signOut = useCallback(() => {
    setSessionId(null);
    clearCookie(SESSION_COOKIE);
  }, []);

  const listingsFor = useCallback(
    (farmerId: string) =>
      listings
        .filter((l) => l.farmer_id === farmerId)
        .sort((a, b) => b.updated_at.localeCompare(a.updated_at)),
    [listings],
  );

  const listingById = useCallback((id: string) => listings.find((l) => l.id === id), [listings]);

  const saveListing = useCallback((listing: ProduceListing) => {
    setListings((list) => {
      const index = list.findIndex((l) => l.id === listing.id);
      if (index === -1) return [listing, ...list];
      return list.map((l) => (l.id === listing.id ? listing : l));
    });
  }, []);

  const newListingId = useCallback(
    () =>
      typeof crypto !== 'undefined' && 'randomUUID' in crypto
        ? crypto.randomUUID()
        : `listing-${Date.now()}`,
    [],
  );

  const value = useMemo<FarmerSessionValue>(
    () => ({
      hydrated,
      language,
      setLanguage,
      farmer,
      signIn,
      register,
      signOut,
      listingsFor,
      listingById,
      saveListing,
      newListingId,
    }),
    [
      hydrated,
      language,
      setLanguage,
      farmer,
      signIn,
      register,
      signOut,
      listingsFor,
      listingById,
      saveListing,
      newListingId,
    ],
  );

  return createElement(FarmerSessionContext.Provider, { value }, children);
}

export function useFarmerSession(): FarmerSessionValue {
  const ctx = useContext(FarmerSessionContext);
  if (!ctx) throw new Error('useFarmerSession must be used inside FarmerSessionProvider');
  return ctx;
}

/** Fixture sign-in: any known farmer phone works; the code is checked elsewhere. */
export { farmerByPhone };
