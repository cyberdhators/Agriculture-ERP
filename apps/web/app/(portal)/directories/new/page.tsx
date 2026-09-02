import type { Metadata } from 'next';

import { RequireEditor } from '@/components/portal/RequireEditor';
import { EntryForm } from '@/components/directories/EntryForm';

export const metadata: Metadata = { title: 'Add directory entry' };

export default function NewEntryPage() {
  return (
    <RequireEditor backHref="/directories" backLabel="Back to directories">
      <EntryForm existing={null} />
    </RequireEditor>
  );
}
