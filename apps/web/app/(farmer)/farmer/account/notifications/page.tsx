import type { Metadata } from 'next';

import { FarmerNotifications } from '@/components/farmer/FarmerNotifications';

export const metadata: Metadata = { title: 'Notifications' };

export default function NotificationsPage() {
  return <FarmerNotifications />;
}
