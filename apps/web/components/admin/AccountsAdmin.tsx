'use client';

import Link from 'next/link';
import { useState } from 'react';

import { ACCOUNT_STATUSES, ACTIVITIES, type AdminAccountRow } from '@agri-erp/shared';

import {
  accountHref,
  actorLabel,
  advisoryLabel,
  formatDateTime,
  publicationLabel,
  signInLabel,
  statusLabel,
  statusStamp,
  timeAgo,
  verificationLabel,
} from '@/lib/admin/accounts-view';
import { useLocationNames } from '@/lib/portal/locations';
import { useQueryState } from '@/lib/query-state';

import { useCursorList } from '../buyer/useCursorList';
import { Button, EmptyState, Field, Notice, PageHeader, SearchInput, Select, Stamp } from '../ui';
import { DataTable, FilterBar, FilterField, LoadingState, Pagination } from '../ui/data';

/**
 * USERS AND ORGANIZATIONS (2026-10-28; the specification, section 4, and
 * infographic 1, panel 2). Every account in one list -- phone and email
 * sign-ins, farmers with no sign-in, organisational profiles -- with search
 * and filters kept in the URL (the Overview's tiles open it filtered).
 * Administrators holding "Assist users" or "Moderate content"; the route
 * refuses anyone else. Searching by phone works only for staff permitted to
 * search by contact; the list never shows a phone or an email.
 *
 * Contact, Suspend, Disable and Restore are on each account's page, where the
 * reason is asked for and the outcome shown.
 */

interface Envelope<T> {
  data?: T;
  page?: { cursor: string | null; hasMore: boolean };
  error?: { message?: string; fields?: Record<string, string> };
}

export function AccountsAdmin() {
  const query = useQueryState();
  const names = useLocationNames(true);
  const q = query.get('q');
  const kind = query.get('kind');
  const signIn = query.get('sign_in');
  const actor = query.get('actor');
  const status = query.get('status');
  const state = query.get('state');
  const from = query.get('from');
  const to = query.get('to');
  const [search, setSearch] = useState(q);

  const filters = new URLSearchParams({ limit: '25' });
  for (const [k, v] of Object.entries({
    q,
    kind,
    sign_in: signIn,
    actor,
    status,
    state,
    from,
    to,
  })) {
    if (v) filters.set(k, v);
  }
  const key = filters.toString();

  const list = useCursorList<AdminAccountRow>(async (cursor) => {
    const params = new URLSearchParams(filters);
    if (cursor) params.set('cursor', cursor);
    let res: Response;
    try {
      res = await fetch(`/api/admin/accounts?${params}`, { cache: 'no-store' });
    } catch {
      throw new Error('The server could not be reached. Check the connection.');
    }
    const body = (await res.json().catch(() => ({}))) as Envelope<AdminAccountRow[]>;
    if (!res.ok) {
      throw new Error(
        res.status === 403
          ? 'You need the "Assist users" or "Moderate content" permission to see accounts.'
          : (Object.values(body.error?.fields ?? {})[0] ??
              body.error?.message ??
              `Not loaded (${res.status}).`),
      );
    }
    return {
      rows: body.data ?? [],
      cursor: body.page?.cursor ?? null,
      hasMore: !!body.page?.hasMore,
    };
  }, key);

  const windowNote = from || to ? `Joined ${from || 'the start'} to ${to || 'today'}. ` : '';

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--s-6)' }}>
      <PageHeader
        title="Users and organizations"
        subtitle="Every account: phone and email sign-ins, farmers registered without one, and organisational profiles."
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
              label="Search accounts"
              placeholder="Name, organisation, farmer number, ID or phone"
              maxLength={100}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </form>
        </FilterField>
        <Field label="Show">
          {(ids) => (
            <Select
              {...ids}
              value={kind}
              onChange={(e) => query.set({ kind: e.target.value || null })}
            >
              <option value="">People and organisations</option>
              <option value="person">People</option>
              <option value="organisation">Organisations</option>
            </Select>
          )}
        </Field>
        <Field label="Actor type">
          {(ids) => (
            <Select
              {...ids}
              value={actor}
              onChange={(e) => query.set({ actor: e.target.value || null })}
            >
              <option value="">All</option>
              {ACTIVITIES.map((a) => (
                <option key={a} value={a}>
                  {actorLabel(a)}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field label="Status">
          {(ids) => (
            <Select
              {...ids}
              value={status}
              onChange={(e) => query.set({ status: e.target.value || null })}
            >
              <option value="">All</option>
              {ACCOUNT_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {statusLabel(s)}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field label="Sign-in">
          {(ids) => (
            <Select
              {...ids}
              value={signIn}
              onChange={(e) => query.set({ sign_in: e.target.value || null })}
            >
              <option value="">Any</option>
              <option value="yes">Has a sign-in</option>
              <option value="no">No sign-in</option>
            </Select>
          )}
        </Field>
        <Field label="Location">
          {(ids) => (
            <Select
              {...ids}
              value={state}
              onChange={(e) => query.set({ state: e.target.value || null })}
            >
              <option value="">All locations</option>
              {names.states.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </Select>
          )}
        </Field>
      </FilterBar>

      {from || to ? (
        <Notice kind="info">
          {windowNote}
          <Button size="small" variant="ghost" onClick={() => query.set({ from: null, to: null })}>
            Clear dates
          </Button>
        </Notice>
      ) : null}

      {list.error ? (
        <EmptyState
          error
          title="Accounts could not be loaded"
          body={list.error}
          actions={<Button onClick={list.reload}>Try again</Button>}
        />
      ) : list.loading ? (
        <LoadingState rows={6} />
      ) : (
        <>
          <DataTable<AdminAccountRow>
            caption="Accounts"
            rows={list.rows}
            rowKey={(r) => `${r.kind}:${r.id}`}
            empty={
              <EmptyState title="No accounts match" body="Change the search or the filters." />
            }
            columns={[
              {
                key: 'name',
                header: 'Name',
                rowHeader: true,
                render: (r) => (
                  <span dir="auto">
                    <Link href={accountHref(r)}>
                      <strong>{r.name}</strong>
                    </Link>
                    <br />
                    <span className="small muted">
                      {r.kind === 'organisation' ? 'Organisation' : signInLabel(r.sign_in)}
                      {r.farmer_number ? ` · ${r.farmer_number}` : ''}
                    </span>
                  </span>
                ),
              },
              {
                key: 'actors',
                header: 'Actor types',
                render: (r) => r.actor_types.map(actorLabel).join(', ') || '—',
              },
              {
                key: 'orgs',
                header: 'Organisations',
                render: (r) => <span dir="auto">{r.organisations.join(', ') || '—'}</span>,
              },
              {
                key: 'joined',
                header: 'Joined',
                nowrap: true,
                render: (r) => formatDateTime(r.joined_at),
              },
              {
                key: 'first',
                header: 'First sign-in',
                nowrap: true,
                render: (r) => formatDateTime(r.first_sign_in_at),
              },
              {
                key: 'last',
                header: 'Last active',
                nowrap: true,
                render: (r) => timeAgo(r.last_active_at),
              },
              {
                key: 'status',
                header: 'Status',
                render: (r) => (
                  <span style={{ display: 'grid', gap: 4, justifyItems: 'start' }}>
                    <Stamp kind={statusStamp(r.status)}>{statusLabel(r.status)}</Stamp>
                    {verificationLabel(r) ? (
                      <span className="small">{verificationLabel(r)}</span>
                    ) : null}
                    <span className="small">{publicationLabel(r.publication)}</span>
                    {r.advisory !== 'none' ? (
                      <span className="small">{advisoryLabel(r.advisory)}</span>
                    ) : null}
                  </span>
                ),
              },
              {
                key: 'actions',
                header: 'Actions',
                printHidden: true,
                render: (r) => (
                  <Link href={accountHref(r)} className="small">
                    {r.kind === 'organisation' ? 'Open organisation' : 'View'}
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
      <p className="small muted">
        Deleted accounts are not listed. Contact, Suspend, Disable and Restore are on each
        account&apos;s page, and every action records a reason.
      </p>
    </div>
  );
}
