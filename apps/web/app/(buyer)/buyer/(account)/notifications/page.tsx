import type { Metadata } from 'next';

import { BuyerNotifications } from '@/components/buyer/BuyerNotifications';

export const metadata: Metadata = { title: 'Notifications' };

export default function BuyerNotificationsPage() {
  return <BuyerNotifications />;
}
