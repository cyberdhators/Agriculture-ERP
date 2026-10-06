import type { Metadata } from 'next';
import Link from 'next/link';

import { RequestForm } from '@/components/buyer/RequestForm';
import { Card, CardBody, PageHeader } from '@/components/ui';

export const metadata: Metadata = { title: 'New purchase request' };

/** A request that is not tied to a listing: "find me 5,000 kg of maize". */
export default function NewBuyerRequestPage() {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--s-6)' }}>
      <Link href="/buyer/purchase-requests" className="small">
        ← Purchase requests
      </Link>
      <PageHeader
        title="New purchase request"
        subtitle="Describe what you need. CORWADO looks for registered farmers who can supply it."
      />
      <Card>
        <CardBody>
          <RequestForm />
        </CardBody>
      </Card>
    </div>
  );
}
