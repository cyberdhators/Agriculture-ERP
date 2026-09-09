'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';

import type { ProduceListing } from '@/lib/fixtures/farmers';

/**
 * Staff moderation state for the marketplace: listings withdrawn with a
 * reason by an admin or supervisor. Held for the browser session so the
 * browse and the product page agree; the API write lands with B12.
 */
interface ModerationState {
  overrides: ReadonlyMap<string, ProduceListing>;
  reasons: ReadonlyMap<string, string>;
  withdraw: (listing: ProduceListing, reason: string) => void;
  hydrated: boolean;
}

const Ctx = createContext<ModerationState | null>(null);
const KEY = 'agri-market-moderation';

interface Stored {
  listings: ProduceListing[];
  reasons: Record<string, string>;
}

export function MarketModerationProvider({ children }: { children: ReactNode }) {
  const [overrides, setOverrides] = useState<Map<string, ProduceListing>>(() => new Map());
  const [reasons, setReasons] = useState<Map<string, string>>(() => new Map());
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    try {
      const raw = window.sessionStorage.getItem(KEY);
      if (raw) {
        const stored = JSON.parse(raw) as Stored;
        setOverrides(new Map(stored.listings.map((l) => [l.id, l])));
        setReasons(new Map(Object.entries(stored.reasons)));
      }
    } catch {
      // Storage blocked: moderation still works for this page.
    }
    setHydrated(true);
  }, []);

  const withdraw = useCallback((listing: ProduceListing, reason: string) => {
    const next: ProduceListing = {
      ...listing,
      status: 'withdrawn',
      updated_at: new Date().toISOString(),
    };
    setOverrides((prev) => {
      const map = new Map(prev);
      map.set(next.id, next);
      setReasons((r) => {
        const rs = new Map(r);
        rs.set(next.id, reason);
        try {
          const stored: Stored = {
            listings: [...map.values()],
            reasons: Object.fromEntries(rs),
          };
          window.sessionStorage.setItem(KEY, JSON.stringify(stored));
        } catch {
          // ignore
        }
        return rs;
      });
      return map;
    });
  }, []);

  const value = useMemo(
    () => ({ overrides, reasons, withdraw, hydrated }),
    [overrides, reasons, withdraw, hydrated],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

const NONE: ModerationState = {
  overrides: new Map(),
  reasons: new Map(),
  withdraw: () => undefined,
  hydrated: true,
};

/** Falls back to an inert state outside the provider (the public marketplace). */
export function useMarketModeration(): ModerationState {
  return useContext(Ctx) ?? NONE;
}
