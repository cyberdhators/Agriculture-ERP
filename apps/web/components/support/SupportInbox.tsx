'use client';

import Link from 'next/link';
import { useState } from 'react';

import {
  CASE_PRIORITIES,
  CASE_PRIORITY_LABELS,
  CASE_TYPES,
  CASE_TYPE_LABELS,
  SUPPORT_STATUSES,
  SUPPORT_STATUS_LABELS,
  caseLabel,
  type CasePriority,
  type SupportMessage,
  type SupportStatus,
} from '@agri-erp/shared';

import { formatDateTime } from '@/lib/admin/accounts-view';
import { useQueryState } from '@/lib/query-state';

import { useCursorList } from '../buyer/useCursorList';
import { Button, EmptyState, Field, PageHeader, SearchInput, Select, Stamp, Tabs } from '../ui';
import { DataTable, FilterBar, FilterField, LoadingState, Pagination } from '../ui/data';

/**
 * SUPPORT CASES (2026-10-21 as "Contact CORWADO" messages; cases since
 * 2026-10-28 -- the specification's line 103: "Case IDs, responsible staff,
 * evidence, status, dates and resolution. Handle technical issues,
 * complaints and appeals."). Administrators holding "Assist users"; the
 * routes refuse anyone else.
 *
 * The list: case ID, type, from, status, priority, who is responsible, dates.
 * Filters live in the URL (the Overview opens it at ?status=open, and appeals
 * at &case_type=appeal). Each case opens its own page, where staff assign it,
 * reply to the person, add notes and evidence, and resolve it with a note.
 */

const FROM_LABEL: Record<SupportMessage['from_kind'], string> = {
  farmer: 'Farmer (signed in)',
  buyer: 'Buyer (signed in)',
  visitor: 'Visitor',
};

const STATUS_STAMP: Record<
  SupportStatus,
  'pending' | 'info' | 'escalated' | 'verified' | 'neutral'
> = {
  new: 'escalated',
  in_progress: 'info',
  waiting: 'pending',
  resolved: 'verified',
  closed: 'neutral',
};

const PRIORITY_STAMP: Record<CasePriority, 'neutral' | 'info' | 'pending' | 'rejected'> = {
  low: 'neutral',
  normal: 'info',
  high: 'pending',
  urgent: 'rejected',
};

type View = 'open' | SupportStatus | 'all';

const VIEWS: { key: View; label: string }[] = [
  { key: 'open', label: 'Open' },
  ...SUPPORT_STATUSES.map((s) => ({ key: s as View, label: SUPPORT_STATUS_LABELS[s] })),
  { key: 'all', label: 'All' },
];

export function SupportInbox() {
  const query = useQueryState();
  const rawStatus = query.get('status');
  const view: View = VIEWS.some((v) => v.key === rawStatus) ? (rawStatus as View) : 'open';
  const caseType = query.get('case_type');
  const priority = query.get('priority');
  const assignee = query.get('assignee');
  const q = query.get('q');
  const [search, setSearch] = useState(q);

  const filters = new URLSearchParams({ limit: '25' });
  if (view !== 'all') filters.set('status', view);
  for (const [k, v] of Object.entries({ case_type: caseType, priority, assignee, q })) {
    if (v) filters.set(k, v);
  }
  const key = filters.toString();

  const list = useCursorList<SupportMessage>(async (cursor) => {
    const params = new URLSearchParams(filters);
    if (cursor) params.set('cursor', cursor);
    let res: Response;
    try {
      res = await fetch(`/api/admin/support?${params}`, { cache: 'no-store' });
    } catch {
      throw new Error('The server could not be reached. Check the connection.');
    }
    const body = (await res.json().catch(() => ({}))) as {
      data?: SupportMessage[];
      page?: { cursor: string | null; hasMore: boolean };
      error?: { message?: string; fields?: Record<string, string> };
    };
    if (!res.ok) {
      throw new Error(
        res.status === 403
          ? 'Support cases are handled by staff with the "Assist users" permission.'
          : (Object.values(body.error?.fields ?? {})[0] ??
              body.error?.message ??
              `The cases could not be read (${res.status}).`),
      );
    }
    return {
      rows: body.data ?? [],
      cursor: body.page?.cursor ?? null,
      hasMore: !!body.page?.hasMore,
    };
  }, key);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--s-6)' }}>
      <PageHeader
        title="Support cases"
        subtitle="Technical issues, complaints, appeals and enquiries sent from the Help page. Assign each case, answer the person, and resolve it with a note."
      />

      <Tabs
        label="Case status"
        value={view}
        onChange={(next) => query.set({ status: next === 'open' ? null : next })}
        items={VIEWS}
      />

      <FilterBar>
        <FilterField>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              query.set({ q: search.trim() || null });
            }}
          >
            <SearchInput
              label="Search cases"
              placeholder="Case number (#1045) or name"
              maxLength={120}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </form>
        </FilterField>
        <Field label="Type">
          {(ids) => (
            <Select
              {...ids}
              value={caseType}
              onChange={(e) => query.set({ case_type: e.target.value || null })}
            >
              <option value="">All types</option>
              {CASE_TYPES.map((t) => (
                <option key={t} value={t}>
                  {CASE_TYPE_LABELS[t]}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field label="Priority">
          {(ids) => (
            <Select
              {...ids}
              value={priority}
              onChange={(e) => query.set({ priority: e.target.value || null })}
            >
              <option value="">Any</option>
              {CASE_PRIORITIES.map((p) => (
                <option key={p} value={p}>
                  {CASE_PRIORITY_LABELS[p]}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field label="Responsible">
          {(ids) => (
            <Select
              {...ids}
              value={assignee}
              onChange={(e) => query.set({ assignee: e.target.value || null })}
            >
              <option value="">Anyone</option>
              <option value="me">Me</option>
              <option value="none">Nobody yet</option>
            </Select>
          )}
        </Field>
      </FilterBar>

      {list.error ? (
        <EmptyState
          error
          title="Cases could not be loaded"
          body={list.error}
          actions={<Button onClick={list.reload}>Try again</Button>}
        />
      ) : list.loading ? (
        <LoadingState rows={5} />
      ) : (
        <>
          <DataTable<SupportMessage>
            caption="Support cases"
            rows={list.rows}
            rowKey={(m) => m.id}
            empty={
              <EmptyState title="No case matches" body="Change the status tab or the filters." />
            }
            columns={[
              {
                key: 'id',
                header: 'Case',
                rowHeader: true,
                nowrap: true,
                render: (m) => (
                  <Link href={`/admin/support/${m.id}`}>
                    <strong className="mono">{caseLabel(m.case_number)}</strong>
                  </Link>
                ),
              },
              {
                key: 'subject',
                header: 'Type and message',
                render: (m) => (
                  <span>
                    <strong>{CASE_TYPE_LABELS[m.case_type]}</strong>
                    <br />
                    <span className="small" dir="auto">
                      {m.body.length > 90 ? `${m.body.slice(0, 90)}…` : m.body}
                    </span>
                  </span>
                ),
              },
              {
                key: 'from',
                header: 'From',
                render: (m) => (
                  <span dir="auto">
                    {m.name}
                    <br />
                    <span className="small muted">{FROM_LABEL[m.from_kind]}</span>
                  </span>
                ),
              },
              {
                key: 'status',
                header: 'Status',
                render: (m) => (
                  <span style={{ display: 'grid', gap: 4, justifyItems: 'start' }}>
                    <Stamp kind={STATUS_STAMP[m.status]}>{SUPPORT_STATUS_LABELS[m.status]}</Stamp>
                    <Stamp kind={PRIORITY_STAMP[m.priority]}>
                      {CASE_PRIORITY_LABELS[m.priority]}
                    </Stamp>
                  </span>
                ),
              },
              {
                key: 'assignee',
                header: 'Responsible',
                render: (m) => m.assignee?.name ?? <span className="muted">Nobody yet</span>,
              },
              {
                key: 'dates',
                header: 'Dates',
                render: (m) => (
                  <span className="small">
                    Opened {formatDateTime(m.created_at)}
                    <br />
                    {m.handled_at
                      ? `Settled ${formatDateTime(m.handled_at)}`
                      : `Updated ${formatDateTime(m.updated_at)}`}
                  </span>
                ),
              },
              {
                key: 'actions',
                header: 'Actions',
                printHidden: true,
                render: (m) => (
                  <Link href={`/admin/support/${m.id}`} className="small">
                    Open case
                  </Link>
                ),
              },
            ]}
          />
          <Pagination
            shown={list.rows.length}
            hasMore={list.hasMore}
            onNext={list.goNext}
            onPrevious={list.goBack}
            canGoBack={list.canGoBack}
          />
        </>
      )}
    </div>
  );
}
