'use client';

import { useEffect, useState } from 'react';

import { Button, ButtonLink, Notice } from '@/components/ui';
import type { Language } from '@/lib/i18n';

/**
 * "Buy" on the market's product page, for every kind of visitor (2026-10-21;
 * the owner: "add to cart is not in every account").
 *
 *   - an account that already buys: straight to the buyer product page, where
 *     the cart is (one cart, one implementation, products from any seller);
 *   - a farmer who has never bought: their buying side is switched on first
 *     (POST /api/farmer/buying -- no second sign-up, CORWADO's "one account"),
 *     then the same page;
 *   - a visitor: sign in or create an account;
 *   - staff: nothing -- staff do not buy.
 *
 * Who is looking is asked of the server, never guessed from the page.
 */

type Viewer = 'loading' | 'buyer' | 'farmer' | 'staff' | 'visitor';

const W = {
  en: {
    buy: 'Add to cart',
    signIn: 'Sign in to buy',
    opening: 'Opening…',
    failed: 'Buying could not be opened. Please try again.',
  },
  ar: {
    buy: 'أضف إلى السلة',
    signIn: 'سجّل الدخول للشراء',
    opening: 'جارٍ الفتح…',
    failed: 'تعذّر فتح الشراء. حاول مرة أخرى.',
  },
} as const;

async function who(): Promise<Viewer> {
  const ok = async (path: string) => (await fetch(path).catch(() => null))?.ok === true;
  if (await ok('/api/buyer/profile')) return 'buyer';
  if (await ok('/api/farmer/me')) return 'farmer';
  if (await ok('/api/me')) return 'staff';
  return 'visitor';
}

export function BuyBox({ listingId, lang }: { listingId: string; lang: Language }) {
  const w = W[lang === 'ar' ? 'ar' : 'en'];
  const [viewer, setViewer] = useState<Viewer>('loading');
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const target = `/buyer/marketplace/${encodeURIComponent(listingId)}`;

  useEffect(() => {
    let cancelled = false;
    void who().then((v) => {
      if (!cancelled) setViewer(v);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  if (viewer === 'staff') return null;
  // While the server answers who is looking, hold the button's place.
  if (viewer === 'loading') return <Button disabled>{w.buy}</Button>;

  async function startBuying() {
    setBusy(true);
    setFailed(false);
    const response = await fetch('/api/farmer/buying', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({}),
    }).catch(() => null);
    if (response?.ok) {
      window.location.assign(target);
      return;
    }
    setBusy(false);
    setFailed(true);
  }

  return (
    // 2026-10-31: just the action -- the page around it says what it is.
    <>
      {viewer === 'buyer' ? (
        <ButtonLink href={target}>{w.buy}</ButtonLink>
      ) : viewer === 'farmer' ? (
        <Button onClick={() => void startBuying()} disabled={busy}>
          {busy ? w.opening : w.buy}
        </Button>
      ) : (
        <ButtonLink href="/join">{w.signIn}</ButtonLink>
      )}
      {failed ? <Notice kind="error">{w.failed}</Notice> : null}
    </>
  );
}
