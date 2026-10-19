import type { Metadata } from 'next';
import { Suspense } from 'react';

import { Messages } from '@/components/messages/Messages';

export const metadata: Metadata = { title: 'Messages' };

export default function BuyerMessagesPage() {
  return (
    <Suspense>
      <Messages language="en" />
    </Suspense>
  );
}
