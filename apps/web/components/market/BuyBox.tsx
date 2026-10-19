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
    title: 'Buy this',
    lead: 'Add it to your cart. You can add products from other sellers and send them all together; each seller gets their own request.',
    buy: 'Add to cart',
    signIn: 'Sign in or create an account to buy',
    opening: 'Opening…',
    failed: 'Buying could not be opened. Please try again.',
  },
  ar: {
    title: 'اشترِ هذا',
    lead: 'أضفه إلى سلتك. يمكنك إضافة منتجات من بائعين آخرين وإرسالها معاً؛ يتلقى كل بائع طلبه الخاص.',
    buy: 'أضف إلى السلة',
    signIn: 'سجّل الدخول أو أنشئ حساباً للشراء',
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

  if (viewer === 'loading' || viewer === 'staff') return null;

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
    <section style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <strong>{w.title}</strong>
      <p className="small muted" style={{ margin: 0 }}>
        {w.lead}
      </p>
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
    </section>
  );
}
