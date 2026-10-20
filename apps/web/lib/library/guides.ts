// Client data layer for the PUBLIC guides page, /learn (2026-10-22, Advice &
// Learning: "Public visitors can browse published listings and advice"). It
// calls the public routes -- GET /api/guides, /api/guides/:id and
// /api/guides/:id/file -- which serve published guides only, through a
// whitelist. With NEXT_PUBLIC_USE_LIVE_LIBRARY off, the published rows of the
// library's fixtures stand in, exactly as the staff library does.
import type { AdviceTopic, Language, ResourceFormat } from '@agri-erp/shared';

import { LEARNING_RESOURCES } from '@/lib/fixtures/p1';

import { LIVE_LIBRARY, LibraryApiError } from './api';

/** One guide as GET /api/guides presents it (presentGuide in lib/api/learning.ts). */
export interface PublicGuide {
  id: string;
  title: string;
  title_ar: string | null;
  summary: string | null;
  summary_ar: string | null;
  topics: AdviceTopic[];
  crop: string | null;
  language: Language;
  format: ResourceFormat;
  byte_size: number;
  published_on: string;
}

export interface GuideFilter {
  topic?: AdviceTopic | '';
  language?: Language | '';
  q?: string;
}

interface Envelope<T> {
  data?: T;
  page?: { cursor: string | null; hasMore: boolean };
  error?: { code: string; message: string };
}

async function get<T>(path: string): Promise<Envelope<T>> {
  const res = await fetch(path, { headers: { accept: 'application/json' } });
  const body = (await res.json().catch(() => ({}))) as Envelope<T>;
  if (!res.ok) {
    throw new LibraryApiError(
      res.status,
      body.error?.code ?? 'request_failed',
      body.error?.message ?? `Request failed (${res.status})`,
    );
  }
  return body;
}

/** The fixtures' published rows, in the public shape. Preview only. */
function fixtureGuides(): PublicGuide[] {
  return LEARNING_RESOURCES.filter((r) => r.deleted_at === null && r.status === 'published').map(
    (r) => ({
      id: r.id,
      title: r.title,
      title_ar: r.title_ar,
      summary: r.description,
      summary_ar: r.description_ar,
      topics: r.topics,
      crop: r.crop,
      language: r.language,
      format: r.format,
      byte_size: r.byte_size,
      published_on: r.published_at ?? r.uploaded_at,
    }),
  );
}

/** The same filter the route applies, for the preview's fixtures. */
export function matchesGuide(guide: PublicGuide, filter: GuideFilter): boolean {
  if (filter.topic && !guide.topics.includes(filter.topic)) return false;
  if (filter.language && guide.language !== filter.language) return false;
  const q = filter.q?.trim().toLocaleLowerCase();
  if (!q) return true;
  return [guide.title, guide.title_ar ?? '', guide.summary ?? '', guide.summary_ar ?? '']
    .join(' ')
    .toLocaleLowerCase()
    .includes(q);
}

/** Every published guide matching the filter, newest first, following the cursor to the end. */
export async function listGuides(filter: GuideFilter): Promise<PublicGuide[]> {
  if (!LIVE_LIBRARY) {
    return fixtureGuides()
      .filter((g) => matchesGuide(g, filter))
      .sort((a, b) => b.published_on.localeCompare(a.published_on));
  }
  const out: PublicGuide[] = [];
  let cursor: string | null = null;
  do {
    const qs = new URLSearchParams({ limit: '100' });
    if (filter.topic) qs.set('topic', filter.topic);
    if (filter.language) qs.set('language', filter.language);
    if (filter.q?.trim()) qs.set('q', filter.q.trim());
    if (cursor) qs.set('cursor', cursor);
    const body: Envelope<PublicGuide[]> = await get(`/api/guides?${qs}`);
    out.push(...(body.data ?? []));
    cursor = body.page?.hasMore ? (body.page.cursor ?? null) : null;
  } while (cursor);
  return out;
}

/** One published guide, or null when there is none (the route's 404). */
export async function getGuide(id: string): Promise<PublicGuide | null> {
  if (!LIVE_LIBRARY) return fixtureGuides().find((g) => g.id === id) ?? null;
  try {
    return (await get<PublicGuide>(`/api/guides/${encodeURIComponent(id)}`)).data ?? null;
  } catch (e) {
    if (e instanceof LibraryApiError && e.status === 404) return null;
    throw e;
  }
}

/** A read link to the guide's file, expiring in minutes. Null in the preview: there is no file. */
export async function guideFileLink(id: string): Promise<string | null> {
  if (!LIVE_LIBRARY) return null;
  const body = await get<{ url: string }>(`/api/guides/${encodeURIComponent(id)}/file`);
  return body.data?.url ?? null;
}

/** The title and summary in the reader's language, falling back to English. */
export function guideText(
  guide: Pick<PublicGuide, 'title' | 'title_ar' | 'summary' | 'summary_ar'>,
  language: Language,
): { title: string; summary: string | null; translated: boolean } {
  if (language === 'ar' && guide.title_ar) {
    return { title: guide.title_ar, summary: guide.summary_ar ?? guide.summary, translated: true };
  }
  return { title: guide.title, summary: guide.summary, translated: language !== 'ar' };
}
