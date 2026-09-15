import { redirect } from 'next/navigation';

import { frontDoor } from '@/lib/auth/paths';

/**
 * The front door is the marketplace: a visitor sees produce first, a farmer
 * signs in from its masthead, and staff use /login by its own address. Only
 * NEXT_PUBLIC_MARKET_OPEN=0 closes it, sending the root to sign-in.
 */
export default function Home() {
  redirect(frontDoor());
}
