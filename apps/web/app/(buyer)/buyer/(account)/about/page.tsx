import type { Metadata } from 'next';

import { AccountActivities } from '@/components/account/AccountActivities';

export const metadata: Metadata = { title: 'About you' };

export default function BuyerAboutPage() {
  return <AccountActivities language="en" />;
}
