'use client';

import Link from 'next/link';
import { useMemo } from 'react';

import { DIRECTORY_ENTRY_TYPES, type DirectoryEntryType } from '@agri-erp/shared';

import { PAYAMS, payamName } from '@/lib/fixtures/p1';
import { ENTRY_TYPE_PLURAL, formatPhone, monogram, pluralise } from '@/lib/format';
import { canEdit, canSeeHidden, usePreview } from '@/lib/preview';
import { useQueryState } from '@/lib/query-state';

import {
  Avatar,
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
import { EntryDetail } from './EntryDetail';
import { TYPE_TONE, freshness, matchesQuery } from './entry-presentation';

type TypeFilter = DirectoryEntryType | 'all';

/**
 * Directories, C-13.1 to C-13.5. One screen for all three directories, split
 * into a list and a detail pane, following the dense list on page 2 of the
 * web design. Type tabs, free-text search and a payam filter narrow the list;
 * the selected entry sits in the URL.
 *
 * Roles: everyone signed in can read. Administrators create, edit and remove.
 * Inactive entries are hidden from officers and read-only users, and shown
 * (marked) to administrators and supervisors when "Show inactive" is on.
 */
export function DirectoriesScreen() {
  const { role, entries, hydrated, catalog } = usePreview();
  const { get, set } = useQueryState();

  const type = (DIRECTORY_ENTRY_TYPES as readonly string[]).includes(get('type'))
    ? (get('type') as DirectoryEntryType)
    : 'all';
  const query = get('q');
  const payam = get('payam');
  const showInactive = canSeeHidden(role) && get('inactive') === '1';
  const selectedId = get('entry');

  const visible = useMemo(() => {
    return entries
      .filter((e) => e.deleted_at === null)
      .filter((e) => (showInactive ? true : e.active))
      .filter((e) => type === 'all' || e.entry_type === type)
      .filter((e) => !payam || e.payam_id === payam)
      .filter((e) => matchesQuery(e, query))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [entries, showInactive, type, payam, query]);

  const counts = useMemo(() => {
    const base = entries.filter(
      (e) =>
        e.deleted_at === null && (showInactive || e.active) && (!payam || e.payam_id === payam),
    );
    const byType = Object.fromEntries(
      DIRECTORY_ENTRY_TYPES.map((t) => [t, base.filter((e) => e.entry_type === t).length]),
    ) as Record<DirectoryEntryType, number>;
    return { all: base.length, ...byType };
  }, [entries, showInactive, payam]);

  const selected = visible.find((e) => e.id === selectedId) ?? visible[0] ?? null;
  const editor = canEdit(role);

  const tabs = [
    { key: 'all' as TypeFilter, label: 'All', count: counts.all },
    ...DIRECTORY_ENTRY_TYPES.map((t) => ({
      key: t as TypeFilter,
      label: ENTRY_TYPE_PLURAL[t],
      count: counts[t],
    })),
  ];

  const filterSummary = [
    type === 'all' ? 'all directories' : ENTRY_TYPE_PLURAL[type].toLocaleLowerCase(),
    payam ? `in ${payamName(payam)} Payam` : 'in Juba County',
    query ? `matching “${query}”` : null,
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <>
      <PageHeader
        eyebrow="Directories"
        title="Agro-dealers, suppliers and financial services"
        subtitle="Where an officer sends a farmer for seed, fertiliser, tools, savings or a loan. Every entry carries the date it was last checked."
        actions={
          hydrated && editor ? (
            <ButtonLink href="/directories/new">
              <IconPlus size={18} />
              Add entry
            </ButtonLink>
          ) : null
        }
      />

      <div className={`${styles.toolbar} no-print`}>
        <Tabs
          label="Directory type"
          items={tabs}
          value={type}
          onChange={(key) => set({ type: key === 'all' ? null : key, entry: null })}
        />
        <div className={styles.toolbarSearch}>
          <SearchInput
            label="Search entries"
            placeholder="Search name, phone, service…"
            value={query}
            onChange={(event) => set({ q: event.target.value, entry: null })}
          />
        </div>
        <div className={styles.toolbarSelect}>
          <label htmlFor="payam-filter" className="visually-hidden">
            Payam
          </label>
          <Select
            id="payam-filter"
            value={payam}
            onChange={(event) => set({ payam: event.target.value, entry: null })}
          >
            <option value="">All payams, Juba County</option>
            {PAYAMS.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name} Payam
              </option>
            ))}
          </Select>
        </div>
        {hydrated && canSeeHidden(role) ? (
          <Checkbox
            label="Show inactive"
            checked={showInactive}
            onChange={(event) => set({ inactive: event.target.checked ? '1' : null, entry: null })}
          />
        ) : null}
      </div>

      <p className={styles.resultLine} aria-live="polite">
        Showing {pluralise(visible.length, 'entry', 'entries')} · {filterSummary} · sorted by name
      </p>

      {catalog.loading ? (
        <p className="muted">Reading the directories.</p>
      ) : catalog.error ? (
        <EmptyState error title="The directories could not be read" body={catalog.error} />
      ) : visible.length === 0 ? (
        <EmptyState
          title={query ? `No entries match “${query}”` : 'No entries here yet'}
          body={
            query
              ? 'Try the whole county, check the spelling, or search by phone number.'
              : editor
                ? 'Add the first entry for this directory. Officers see it as soon as it is saved.'
                : 'Nothing has been added for this filter. Ask a programme administrator to add entries.'
          }
          actions={
            <>
              {query || payam ? (
                <ButtonLink href="/directories" variant="secondary">
                  Clear filters
                </ButtonLink>
              ) : null}
              {editor ? <ButtonLink href="/directories/new">Add entry</ButtonLink> : null}
            </>
          }
        />
      ) : (
        <div className={styles.split}>
          <Card className={styles.listPane} as="div" aria-label="Directory entries">
            <ul className={styles.list}>
              {visible.map((entry) => {
                const fresh = freshness(entry);
                const current = selected?.id === entry.id;
                return (
                  <li key={entry.id}>
                    <Link
                      href={{
                        pathname: '/directories',
                        query: { ...currentQuery(get), entry: entry.id },
                      }}
                      scroll={false}
                      className={`${styles.row} ${entry.active ? '' : styles.rowInactive}`}
                      aria-current={current ? 'true' : undefined}
                    >
                      <Avatar text={monogram(entry.name)} tone={TYPE_TONE[entry.entry_type]} />
                      <span className={styles.rowMain}>
                        <span className={styles.rowTitle} dir="auto">
                          {entry.name}
                        </span>
                        <span className={styles.rowMeta}>
                          <span>{payamName(entry.payam_id)}</span>
                          {entry.services.length ? (
                            <span dir="auto">{entry.services.slice(0, 3).join(', ')}</span>
                          ) : null}
                        </span>
                      </span>
                      <span className={styles.rowSide}>
                        <span className="num small">{formatPhone(entry.phone)}</span>
                        {!entry.active ? (
                          <Badge tone="neutral" outline>
                            Inactive
                          </Badge>
                        ) : (
                          <Badge tone={fresh.tone} outline={fresh.tone === 'leaf'} dot>
                            {fresh.tone === 'leaf' ? 'Checked' : fresh.short}
                          </Badge>
                        )}
                      </span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          </Card>

          {selected ? <EntryDetail entry={selected} /> : null}
        </div>
      )}
    </>
  );
}

function currentQuery(get: (key: string) => string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const key of ['type', 'q', 'payam', 'inactive']) {
    const value = get(key);
    if (value) out[key] = value;
  }
  return out;
}
