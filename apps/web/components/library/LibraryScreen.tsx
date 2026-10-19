'use client';

import Link from 'next/link';
import { useMemo } from 'react';

import {
  ADVICE_TOPICS,
  CROPS,
  LANGUAGES,
  LEARNING_STATUSES,
  RESOURCE_FORMATS,
  type AdviceTopic,
  type Crop,
  type Language,
  type LearningStatus,
} from '@agri-erp/shared';

import {
  ADVICE_TOPIC_LABELS,
  CROP_LABELS,
  FORMAT_LABELS,
  LANGUAGE_LABELS,
  LEARNING_STATUS_LABELS,
  formatBytes,
  formatDate,
  pluralise,
} from '@/lib/format';
import { usePreview } from '@/lib/preview';
import { useContentAccess } from '@/lib/library/access';
import { canSeeUnpublished } from '@/lib/library/library-view';
import { useQueryState } from '@/lib/query-state';

import { ButtonLink, Card, EmptyState, PageHeader, SearchInput, Select, Tabs } from '../ui';
import { IconPlus } from '../ui/icons';
import styles from '../screens.module.css';
import { ResourceDetail } from './ResourceDetail';
import { FormatIcon, StatusBadge, matchesResource } from './resource-presentation';

function pick<T extends string>(list: readonly T[], value: string): T | '' {
  return (list as readonly string[]).includes(value) ? (value as T) : '';
}

/**
 * Learning library, C-13.6 to C-13.9. A repository: browse by topic, crop,
 * language and format, open one, download it. No enrolment, no progress.
 *
 * 2026-10-22, Advice & Learning: every guide has a state -- draft, in review,
 * published, unpublished -- and an administrator moves between them with the
 * status tabs. Only published guides reach officers and the public page
 * (/learn). Writing and submitting need "Moderate content" or "Publish
 * content"; returning, publishing and unpublishing need "Publish content"
 * (useContentAccess; the routes decide).
 *
 * Roles, as the route actually enforces them: everyone but an administrator
 * sees published resources only -- the list adds `status = 'published'` for
 * any caller whose scope is not `all`, and only an administrator has that
 * scope. So only an administrator is offered the other tabs.
 */
export function LibraryScreen() {
  const { role, resources, hydrated, catalog } = usePreview();
  const access = useContentAccess();
  const { get, set } = useQueryState();

  const format = pick(RESOURCE_FORMATS, get('format'));
  const topic = pick(ADVICE_TOPICS, get('topic'));
  const crop = pick(CROPS, get('crop'));
  const language = pick(LANGUAGES, get('lang'));
  const query = get('q');
  /*
   * ONLY AN ADMINISTRATOR IS SENT A DRAFT.
   *
   * `GET /api/learning-resources` returns published cards only to any caller
   * whose scope is not `all`, and only an administrator has that scope. So the
   * status tabs are an administrator's; everyone else sees published guides.
   */
  const seesAll = hydrated && canSeeUnpublished(role);
  const status: LearningStatus = seesAll
    ? pick(LEARNING_STATUSES, get('status')) || 'published'
    : 'published';
  const selectedId = get('resource');
  const editor = access.write;

  const live = useMemo(() => resources.filter((r) => r.deleted_at === null), [resources]);

  const visible = useMemo(
    () =>
      live
        .filter((r) => r.status === status)
        .filter((r) => !format || r.format === format)
        .filter((r) => !topic || r.topics.includes(topic))
        .filter((r) => !crop || r.crop === crop)
        .filter((r) => !language || r.language === language)
        .filter((r) => matchesResource(r, query))
        .sort((a, b) => b.uploaded_at.localeCompare(a.uploaded_at)),
    [live, status, format, topic, crop, language, query],
  );

  const counts = useMemo(
    () =>
      Object.fromEntries(
        LEARNING_STATUSES.map((st) => [st, live.filter((r) => r.status === st).length]),
      ) as Record<LearningStatus, number>,
    [live],
  );

  const selected = visible.find((r) => r.id === selectedId) ?? visible[0] ?? null;
  const filtered = Boolean(topic || crop || language || query || format);

  return (
    <>
      <PageHeader
        eyebrow="Advice and learning"
        title="Guides, audio and video for the field"
        subtitle="Written as a draft, checked in review, then published to officers and to the public guides page. Sizes are shown so nobody starts a 40 MB download on a metered connection by accident."
        actions={
          editor ? (
            <ButtonLink href="/library/new">
              <IconPlus size={18} />
              Add resource
            </ButtonLink>
          ) : null
        }
      />

      <div className={`${styles.toolbar} no-print`}>
        {seesAll ? (
          <Tabs
            label="Status"
            items={LEARNING_STATUSES.map((st) => ({
              key: st,
              label: LEARNING_STATUS_LABELS[st],
              count: counts[st],
            }))}
            value={status}
            onChange={(key) => set({ status: key === 'published' ? null : key, resource: null })}
          />
        ) : null}
        <div className={styles.toolbarSearch}>
          <SearchInput
            label="Search resources"
            placeholder="Search title or description…"
            value={query}
            onChange={(event) => set({ q: event.target.value, resource: null })}
          />
        </div>
        <div className={styles.toolbarSelect}>
          <label htmlFor="topic-filter" className="visually-hidden">
            Topic
          </label>
          <Select
            id="topic-filter"
            value={topic}
            onChange={(event) => set({ topic: event.target.value, resource: null })}
          >
            <option value="">Any topic</option>
            {ADVICE_TOPICS.map((t: AdviceTopic) => (
              <option key={t} value={t}>
                {ADVICE_TOPIC_LABELS[t]}
              </option>
            ))}
          </Select>
        </div>
        <div className={styles.toolbarSelect}>
          <label htmlFor="format-filter" className="visually-hidden">
            Format
          </label>
          <Select
            id="format-filter"
            value={format}
            onChange={(event) => set({ format: event.target.value, resource: null })}
          >
            <option value="">Any format</option>
            {RESOURCE_FORMATS.map((f) => (
              <option key={f} value={f}>
                {FORMAT_LABELS[f]}
              </option>
            ))}
          </Select>
        </div>
        <div className={styles.toolbarSelect}>
          <label htmlFor="crop-filter" className="visually-hidden">
            Crop
          </label>
          <Select
            id="crop-filter"
            value={crop}
            onChange={(event) => set({ crop: event.target.value, resource: null })}
          >
            <option value="">Any crop</option>
            {CROPS.map((c: Crop) => (
              <option key={c} value={c}>
                {CROP_LABELS[c]}
              </option>
            ))}
          </Select>
        </div>
        <div className={styles.toolbarSelect}>
          <label htmlFor="lang-filter" className="visually-hidden">
            Language
          </label>
          <Select
            id="lang-filter"
            value={language}
            onChange={(event) => set({ lang: event.target.value, resource: null })}
          >
            <option value="">Any language</option>
            {LANGUAGES.map((l: Language) => (
              <option key={l} value={l}>
                {LANGUAGE_LABELS[l]}
              </option>
            ))}
          </Select>
        </div>
      </div>

      <p className={styles.resultLine} aria-live="polite">
        Showing {pluralise(visible.length, 'resource')} · {LEARNING_STATUS_LABELS[status]} · newest
        first
      </p>

      {catalog.loading ? (
        <p className="muted">Reading the library.</p>
      ) : catalog.error ? (
        <EmptyState error title="The library could not be read" body={catalog.error} />
      ) : visible.length === 0 ? (
        <EmptyState
          title={
            filtered
              ? 'No resources match these filters'
              : status === 'published'
                ? 'Nothing is published yet'
                : `Nothing is ${LEARNING_STATUS_LABELS[status].toLowerCase()}`
          }
          body={
            filtered
              ? 'Try fewer filters, or search for a word from the title.'
              : status !== 'published'
                ? 'Guides appear here as they move through review.'
                : editor
                  ? 'Add the first resource, submit it for review, and publish it. Officers and the public guides page see it once it is published.'
                  : 'Nothing has been published yet. Ask a programme administrator to add resources.'
          }
          actions={
            <>
              {filtered ? (
                <ButtonLink href="/library" variant="secondary">
                  Clear filters
                </ButtonLink>
              ) : null}
              {editor ? <ButtonLink href="/library/new">Add resource</ButtonLink> : null}
            </>
          }
        />
      ) : (
        <div className={styles.split}>
          <Card
            className={`${styles.listPane} ${styles.tableWrap}`}
            as="div"
            aria-label="Resources"
          >
            <table className={styles.table}>
              <thead>
                <tr>
                  <th scope="col">Title</th>
                  <th scope="col">Topic</th>
                  <th scope="col">Language</th>
                  <th scope="col" className={styles.tdNum}>
                    Size
                  </th>
                  <th scope="col">Status</th>
                </tr>
              </thead>
              <tbody>
                {visible.map((row) => (
                  <tr key={row.id} aria-current={selected?.id === row.id ? 'true' : undefined}>
                    <td>
                      <span className={styles.tdTitle}>
                        <span className={styles.formatTile} title={FORMAT_LABELS[row.format]}>
                          <FormatIcon format={row.format} />
                        </span>
                        <span style={{ display: 'grid', gap: 2, minWidth: 0 }}>
                          <Link
                            href={{
                              pathname: '/library',
                              query: { ...currentQuery(get), resource: row.id },
                            }}
                            scroll={false}
                            className={styles.titleLink}
                            dir="auto"
                          >
                            {row.title}
                          </Link>
                          <span className="small muted">
                            {FORMAT_LABELS[row.format]}
                            {row.crop ? ` · ${CROP_LABELS[row.crop]}` : ''} ·{' '}
                            {formatDate(row.uploaded_at)}
                          </span>
                        </span>
                      </span>
                    </td>
                    <td className={styles.tdNowrap}>
                      {row.topics.map((t) => ADVICE_TOPIC_LABELS[t]).join(', ')}
                    </td>
                    <td className={styles.tdNowrap}>{LANGUAGE_LABELS[row.language]}</td>
                    <td className={`${styles.tdNum} num`}>{formatBytes(row.byte_size)}</td>
                    <td className={styles.tdNowrap}>
                      <StatusBadge status={row.status} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>

          {selected ? <ResourceDetail resource={selected} /> : null}
        </div>
      )}
    </>
  );
}

function currentQuery(get: (key: string) => string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const key of ['status', 'format', 'topic', 'crop', 'lang', 'q']) {
    const value = get(key);
    if (value) out[key] = value;
  }
  return out;
}
