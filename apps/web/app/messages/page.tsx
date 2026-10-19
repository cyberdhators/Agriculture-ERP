'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useEffect } from 'react';

/**
 * /messages -- the way into the inbox from a page both farmers and buyers use
 * (the public market). Sends the person to their own side's inbox, keeping
 * the conversation it was asked to open. One account that buys and sells has
 * one inbox; the farmer side is its home.
 */
function Route() {
  const router = useRouter();
  const params = useSearchParams();
  useEffect(() => {
    const c = params.get('c');
    const query = c ? `?c=${encodeURIComponent(c)}` : '';
    const go = async () => {
      const ok = async (path: string) => (await fetch(path).catch(() => null))?.ok === true;
      if (await ok('/api/farmer/me')) router.replace(`/farmer/account/messages${query}`);
      else if (await ok('/api/buyer/profile')) router.replace(`/buyer/messages${query}`);
      else router.replace('/join');
    };
    void go();
  }, [params, router]);
  return null;
}

export default function MessagesRoute() {
  return (
    <Suspense>
      <Route />
    </Suspense>
  );
}
