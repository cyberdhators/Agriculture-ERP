'use client';

import { useSyncExternalStore } from 'react';

import { CART_MAX_ITEMS } from '@agri-erp/shared';

/**
 * THE BUYER'S CART (B14, 2026-10-07).
 *
 * A buyer gathers products from different farmers and sends them together
 * (POST /api/buyer/cart). Until it is sent the cart is a convenience held in
 * this browser, not a record: nothing in it reaches a farmer, and losing it
 * loses nothing that was promised. Each line keeps enough of the listing to
 * draw the cart without asking the server again.
 *
 * ONE CART PER BUYER, not per browser. The buyer shell names the owner once the
 * profile is known (setCartOwner); until then, and after sign-out, there is no
 * cart at all. Two buyers on one computer never see -- or send -- each other's.
 */
export interface CartLine {
  listing_id: string;
  title: string;
  product_name: string;
  trading_name: string;
  location: string;
  quantity: number;
  unit: string;
  price_ssp: number;
  price_per: string;
  notes?: string;
}

const PREFIX = 'agrione.buyer.cart.v2.';
const EMPTY: readonly CartLine[] = [];
let owner: string | null = null;
let cache: readonly CartLine[] | null = null;
const listeners = new Set<() => void>();
const key = () => (owner ? PREFIX + owner : null);

/** The signed-in buyer whose cart this is; null on sign-out. */
export function setCartOwner(buyerId: string | null): void {
  if (owner === buyerId) return;
  owner = buyerId;
  cache = null;
  for (const l of listeners) l();
}

function read(): readonly CartLine[] {
  if (!owner) return EMPTY;
  if (cache) return cache;
  try {
    const raw = window.localStorage.getItem(key()!);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    cache = Array.isArray(parsed) ? (parsed as CartLine[]) : [];
  } catch {
    cache = [];
  }
  return cache;
}

function write(lines: readonly CartLine[]): void {
  if (!owner) return;
  cache = lines;
  try {
    window.localStorage.setItem(key()!, JSON.stringify(lines));
  } catch {
    // Private window or storage blocked: the cart lives for this page only.
  }
  for (const l of listeners) l();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  const onStorage = (e: StorageEvent) => {
    if (e.key !== null && e.key === key()) {
      cache = null;
      listener();
    }
  };
  window.addEventListener('storage', onStorage);
  return () => {
    listeners.delete(listener);
    window.removeEventListener('storage', onStorage);
  };
}

export function useCart(): readonly CartLine[] {
  return useSyncExternalStore(subscribe, read, () => EMPTY);
}

/** Adds a product, or replaces its line if it is already in the cart. False when full. */
export function addToCart(line: CartLine): boolean {
  if (!owner) return false;
  const lines = read();
  const exists = lines.some((l) => l.listing_id === line.listing_id);
  if (!exists && lines.length >= CART_MAX_ITEMS) return false;
  write(
    exists ? lines.map((l) => (l.listing_id === line.listing_id ? line : l)) : [...lines, line],
  );
  return true;
}

export function updateCartLine(listingId: string, patch: Partial<CartLine>): void {
  write(read().map((l) => (l.listing_id === listingId ? { ...l, ...patch } : l)));
}

export function removeFromCart(listingId: string): void {
  write(read().filter((l) => l.listing_id !== listingId));
}

export function clearCart(): void {
  write([]);
}
