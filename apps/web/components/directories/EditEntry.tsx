'use client';

import { usePreview } from '@/lib/preview';

import { RequireEditor } from '../portal/RequireEditor';
import { ButtonLink, EmptyState } from '../ui';
import { EntryForm } from './EntryForm';

export function EditEntry({ id }: { id: string }) {
  const { entries } = usePreview();
  const entry = entries.find((e) => e.id === id) ?? null;

  return (
    <RequireEditor backHref="/directories" backLabel="Back to directories">
      {entry ? (
        <EntryForm key={entry.id} existing={entry} />
      ) : (
        <EmptyState
          error
          title="This entry does not exist"
          body="The link may be old, or the entry was created in another session of this preview. Go back to the list and open it from there."
          actions={<ButtonLink href="/directories">Back to directories</ButtonLink>}
        />
      )}
    </RequireEditor>
  );
}
