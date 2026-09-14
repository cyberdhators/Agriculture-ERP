'use client';

import Link from 'next/link';
import { useMemo } from 'react';

import {
  CROPS,
  LANGUAGES,
  LEARNING_TOPICS,
  RESOURCE_FORMATS,
  type Crop,
  type Language,
  type LearningTopic,
  type ResourceFormat,
} from '@agri-erp/shared';

import {
  CROP_LABELS,
  FORMAT_LABELS,
  LANGUAGE_LABELS,
  TOPIC_LABELS,
  formatBytes,
  formatDate,
  pluralise,
} from '@/lib/format';
import { canEdit, canSeeHidden, usePreview } from '@/lib/preview';
import { useQueryState } from '@/lib/query-state';

import {
  Badge,
  ButtonLink,
  Card,
  Checkbox,
  EmptyState,
  PageHeader,
  SearchInput,
  Select,
  Tabs,
} from '../ui';
import { IconPlus } from '../ui/icons';
import styles from '../screens.module.css';
import { ResourceDetail } from './ResourceDetail';
import { FormatIcon, matchesResource } from './resource-presentation';

type FormatFilter = ResourceFormat | 'all';

function pick<T extends string>(list: readonly T[], value: string): T | '' {
  return (list as readonly string[]).includes(value) ? (value as T) : '';
}

/**
 * Learning library, C-13.6 to C-13.9. A repository: browse by topic, crop,
 * language and format, open one, download it. No enrolment, no progress.
 *
 * Roles: officers and read-only users see published resources only.
 * Administrators and supervisors can also see unpublished ones, marked, with
 * "Show unpublished". Administrators add, edit and remove.
 */
export function LibraryScreen() {
  const { role, resources, hydrated, catalog } = usePreview();
  const { get, set } = useQueryState();

  const format: FormatFilter = pick(RESOURCE_FORMATS, get('format')) || 'all';
  const topic = pick(LEARNING_TOPICS, get('topic'));
  const crop = pick(CROPS, get('crop'));
  const language = pick(LANGUAGES, get('lang'));
  const query = get('q');
  const showUnpublished = canSeeHidden(role) && get('drafts') === '1';
  const selectedId = get('resource');
  const editor = hydrated && canEdit(role);

  const visible = useMemo(
    () =>
      resources
        .filter((r) => r.deleted_at === null)
        .filter((r) => (showUnpublished ? true : r.published))
        .filter((r) => format === 'all' || r.format === format)
        .filter((r) => !topic || r.topic === topic)
        .filter((r) => !crop || r.crop === crop)
        .filter((r) => !language || r.language === language)
        .filter((r) => matchesResource(r, query))
        .sort((a, b) => b.uploaded_at.localeCompare(a.uploaded_at)),
    [resources, showUnpublished, format, topic, crop, language, query],
  );

  const counts = useMemo(() => {
    const base = resources.filter((r) => r.deleted_at === null && (showUnpublished || r.published));
    return {
      all: base.length,
      ...(Object.fromEntries(
        RESOURCE_FORMATS.map((f) => [f, base.filter((r) => r.format === f).length]),
      ) as Record<ResourceFormat, number>),
    };
  }, [resources, showUnpublished]);

  const selected = visible.find((r) => r.id === selectedId) ?? visible[0] ?? null;
  const filtered = Boolean(topic || crop || language || query || format !== 'all');

  return (
    <>
      <PageHeader
        eyebrow="Learning library"
        title="Guides, audio and video for the field"
        subtitle="Materials officers open on the phone and share with farmers. Sizes are shown so nobody starts a 40 MB download on a metered connection by accident."
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
        <Tabs
          label="Format"
          items={[
            { key: 'all' as FormatFilter, label: 'All', count: counts.all },
            ...RESOURCE_FORMATS.map((f) => ({
              key: f as FormatFilter,
              label: FORMAT_LABELS[f],
              count: counts[f],
            })),
          ]}
          value={format}
          onChange={(key) => set({ format: key === 'all' ? null : key, resource: null })}
        />
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
            {LEARNING_TOPICS.map((t: LearningTopic) => (
              <option key={t} value={t}>
                {TOPIC_LABELS[t]}
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
        {hydrated && canSeeHidden(role) ? (
          <Checkbox
            label="Show unpublished"
            checked={showUnpublished}
            onChange={(event) => set({ drafts: event.target.checked ? '1' : null, resource: null })}
          />
        ) : null}
      </div>

      <p className={styles.resultLine} aria-live="polite">
        Showing {pluralise(visible.length, 'resource')} · newest first
        {showUnpublished ? ' · including unpublished' : ''}
      </p>

      {catalog.loading ? (
        <p className="muted">Reading the library.</p>
      ) : catalog.error ? (
        <EmptyState error title="The library could not be read" body={catalog.error} />
      ) : visible.length === 0 ? (
        <EmptyState
          title={filtered ? 'No resources match these filters' : 'The library is empty'}
          body={
            filtered
              ? 'Try fewer filters, or search for a word from the title.'
              : editor
                ? 'Add the first resource. Officers see it as soon as it is published.'
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
                    <td className={styles.tdNowrap}>{TOPIC_LABELS[row.topic]}</td>
                    <td className={styles.tdNowrap}>{LANGUAGE_LABELS[row.language]}</td>
                    <td className={`${styles.tdNum} num`}>{formatBytes(row.byte_size)}</td>
                    <td className={styles.tdNowrap}>
                      {row.published ? (
                        <Badge tone="leaf" dot>
                          Published
                        </Badge>
                      ) : (
                        <Badge tone="sorghum" dot>
                          Unpublished
                        </Badge>
                      )}
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
  for (const key of ['format', 'topic', 'crop', 'lang', 'q', 'drafts']) {
    const value = get(key);
    if (value) out[key] = value;
  }
  return out;
}
