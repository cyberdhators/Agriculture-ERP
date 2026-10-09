import type { Metadata } from 'next';

import { RecoverAccount } from '@/components/auth/RecoverAccount';

export const metadata: Metadata = { title: 'Use a recovery code' };

export default function RecoverPage() {
  return <RecoverAccount />;
}
