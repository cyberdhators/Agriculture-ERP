import { redirect } from 'next/navigation';

import { BUYER_HOME_PATH } from '@/lib/auth/paths';

/** /buyer on its own is the dashboard. */
export default function BuyerIndexPage() {
  redirect(BUYER_HOME_PATH);
}
