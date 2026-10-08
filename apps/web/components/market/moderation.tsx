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
 * Staff moderation for the marketplace: an admin or supervisor withdraws a
 * listing with a reason. Since 2026-10-08 the withdrawal is written to the
 * server (POST /api/listings/:id/withdraw) and the farmer is told; until then it
 * changed only this browser tab. The local copy below just keeps the browse and
 * product page in step until they reload.
 */
interface ModerationState {
  overrides: ReadonlyMap<string, ProduceListing>;
  reasons: ReadonlyMap<string, string>;
  /** Resolves to null on success, or the server's reason it was refused. */
  withdraw: (listing: ProduceListing, reason: string) => Promise<string | null>;
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

  const withdraw = useCallback(async (listing: ProduceListing, reason: string) => {
    try {
      const res = await fetch(`/api/listings/${listing.id}/withdraw`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ reason }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as {
          error?: { message?: string; fields?: Record<string, string> };
        };
        return (
          body.error?.fields?.reason ??
          body.error?.message ??
          `The listing was not withdrawn (${res.status}).`
        );
      }
    } catch {
      return 'The server could not be reached. The listing was not withdrawn.';
    }
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
    return null;
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
  withdraw: async () => 'Not available here.',
  hydrated: true,
};

/** Falls back to an inert state outside the provider (the public marketplace). */
export function useMarketModeration(): ModerationState {
  return useContext(Ctx) ?? NONE;
}
