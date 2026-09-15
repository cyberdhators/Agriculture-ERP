import { redirect } from 'next/navigation';

import { frontDoor } from '@/lib/auth/paths';

/**
 * The front door. With NEXT_PUBLIC_MARKET_OPEN=1 a visitor lands on the
 * marketplace and sees produce first; a farmer signs in from its masthead and
 * staff use /login by its own address. Until CORWADO's written answer on the
 * contact question sets that flag, the marketplace is behind the staff
 * session and the root goes to sign-in.
 */
export default function Home() {
  redirect(frontDoor());
}
