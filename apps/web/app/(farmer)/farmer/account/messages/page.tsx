'use client';

import { Suspense } from 'react';

import { Messages } from '@/components/messages/Messages';
import { useFarmerSession } from '@/lib/farmer-session';

export default function FarmerMessagesPage() {
  const { language } = useFarmerSession();
  return (
    <Suspense>
      <Messages language={language} />
    </Suspense>
  );
}
