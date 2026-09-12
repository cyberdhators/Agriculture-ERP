'use client';

import { usePreview } from '@/lib/preview';

import { RequireEditor } from '../portal/RequireEditor';
import { ButtonLink, EmptyState } from '../ui';
import { ResourceForm } from './ResourceForm';

export function EditResource({ id }: { id: string }) {
  const { resources } = usePreview();
  const resource = resources.find((r) => r.id === id) ?? null;
  return (
    <RequireEditor backHref="/library" backLabel="Back to library">
      {resource ? (
        <ResourceForm key={resource.id} existing={resource} />
      ) : (
        <EmptyState
          error
          title="This resource does not exist"
          body="The link may be old. Go back to the library and open the resource from there."
          actions={<ButtonLink href="/library">Back to library</ButtonLink>}
        />
      )}
    </RequireEditor>
  );
}
