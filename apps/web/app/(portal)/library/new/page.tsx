import type { Metadata } from 'next';

import { ResourceForm } from '@/components/library/ResourceForm';
import { RequireEditor } from '@/components/portal/RequireEditor';

export const metadata: Metadata = { title: 'Add learning resource' };

export default function NewResourcePage() {
  return (
    <RequireEditor backHref="/library" backLabel="Back to library">
      <ResourceForm existing={null} />
    </RequireEditor>
  );
}
