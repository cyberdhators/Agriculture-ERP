'use client';

import { useRouter } from 'next/navigation';
import { useEffect } from 'react';

/**
 * /organisations -- the way into Organisations from a page both sides use (the
 * invitation page). Sends the person to their own side's page; the farmer side
 * is the home of an account that has both, as for /messages.
 */
export default function OrganisationsRoute() {
  const router = useRouter();
  useEffect(() => {
    const go = async () => {
      const ok = async (path: string) => (await fetch(path).catch(() => null))?.ok === true;
      if (await ok('/api/farmer/me')) router.replace('/farmer/account/organisations');
      else if (await ok('/api/buyer/profile')) router.replace('/buyer/organisations');
      else router.replace('/login');
    };
    void go();
  }, [router]);
  return null;
}
