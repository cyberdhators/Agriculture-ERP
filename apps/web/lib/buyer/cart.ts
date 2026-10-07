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

const KEY = 'agrione.buyer.cart.v1';
const EMPTY: readonly CartLine[] = [];
let cache: readonly CartLine[] | null = null;
const listeners = new Set<() => void>();

function read(): readonly CartLine[] {
  if (cache) return cache;
  try {
    const raw = window.localStorage.getItem(KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    cache = Array.isArray(parsed) ? (parsed as CartLine[]) : [];
  } catch {
    cache = [];
  }
  return cache;
}

function write(lines: readonly CartLine[]): void {
  cache = lines;
  try {
    window.localStorage.setItem(KEY, JSON.stringify(lines));
  } catch {
    // Private window or storage blocked: the cart lives for this page only.
  }
  for (const l of listeners) l();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  const onStorage = (e: StorageEvent) => {
    if (e.key === KEY) {
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
