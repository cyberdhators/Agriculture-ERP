import type { ResourceFormat } from '@agri-erp/shared';

import type { LearningResourceRow } from '@/lib/fixtures/p1';

import { IconAudio, IconImage, IconPdf, IconVideo } from '../ui/icons';

export function FormatIcon({ format, size = 20 }: { format: ResourceFormat; size?: number }) {
  switch (format) {
    case 'pdf':
      return <IconPdf size={size} />;
    case 'image':
      return <IconImage size={size} />;
    case 'audio':
      return <IconAudio size={size} />;
    case 'video':
      return <IconVideo size={size} />;
  }
}

export function matchesResource(row: LearningResourceRow, query: string): boolean {
  if (!query) return true;
  const q = query.toLocaleLowerCase();
  return [row.title, row.description ?? '', row.storage_path]
    .join(' ')
    .toLocaleLowerCase()
    .includes(q);
}
