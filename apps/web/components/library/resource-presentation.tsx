import type { LearningStatus, ResourceFormat } from '@agri-erp/shared';

import type { LearningResourceRow } from '@/lib/fixtures/p1';
import { LEARNING_STATUS_LABELS } from '@/lib/format';

import { Badge, type Tone } from '../ui';
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

/** 2026-10-22: the workflow state, in one colour per state. */
const STATUS_TONE: Record<LearningStatus, Tone> = {
  draft: 'neutral',
  in_review: 'nile',
  published: 'leaf',
  unpublished: 'sorghum',
};

export function StatusBadge({ status }: { status: LearningStatus }) {
  return (
    <Badge tone={STATUS_TONE[status]} dot>
      {LEARNING_STATUS_LABELS[status]}
    </Badge>
  );
}

/** Title, summary and path, in English and Arabic (2026-10-22). */
export function matchesResource(row: LearningResourceRow, query: string): boolean {
  if (!query) return true;
  const q = query.toLocaleLowerCase();
  return [
    row.title,
    row.title_ar ?? '',
    row.description ?? '',
    row.description_ar ?? '',
    row.storage_path,
  ]
    .join(' ')
    .toLocaleLowerCase()
    .includes(q);
}
