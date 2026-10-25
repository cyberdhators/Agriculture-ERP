'use client';

import Link from 'next/link';
import { useState } from 'react';

import {
  INACTIVE_STATUSES,
  LISTING_CATEGORIES,
  MARKETPLACE_KINDS,
  MARKETPLACE_TABS,
  SERVICE_TYPES,
  marketplaceRemoveSchema,
  type AdminMarketplaceDetail,
  type AdminMarketplaceItem,
  type MarketplaceKind,
  type MarketplaceStatus,
  type MarketplaceTab,
  type RemovedMarketplaceItem,
} from '@agri-erp/shared';

import { useLocationNames } from '@/lib/portal/locations';
import { useQueryState } from '@/lib/query-state';
import { formatDate } from '@/lib/format';

import { useCursorList } from '../buyer/useCursorList';
import {
  Button,
  DefinitionList,
  Dialog,
  EmptyState,
  Field,
  Notice,
  PageHeader,
  SearchInput,
  Select,
  Stamp,
  Tabs,
  Textarea,
  type StampKind,
} from '../ui';
import { DataTable, FilterBar, FilterField, LoadingState, Pagination } from '../ui/data';
import { ConfirmationDialog, useToast } from '../ui/feedback';

import { RequestCorrectionButton } from './Corrections';
import { ReasonCodeSelect, useReasonCodes } from './ReasonCodeSelect';

/**
 * THE MARKETPLACE CONSOLE (2026-10-28, CORWADO's specification, Marketplace:
 * "Produce, inputs, buying requests, services and inactive listings. Inspect,
 * request correction and moderate with a reason; listing removal is separate
 * from account action"). For staff holding "Moderate content and listings";
 * every route behind it refuses anyone else.
 *
 * Filters live in the URL. Inspect opens one post; Request a correction asks
 * its owner to fix it (it stays live); Remove takes it off with a reason. The
 * account is never touched from here: its own page has Suspend and Disable.
 */

const TAB_LABEL: Record<MarketplaceTab, string> = {
  produce: 'Produce',
  inputs: 'Inputs',
  buying_requests: 'Buying requests',
  services: 'Services',
  inactive: 'Inactive',
};

const KIND_LABEL: Record<MarketplaceKind, string> = {
  produce_listing: 'Product listing',
  buying_request: 'Buying request',
  service_listing: 'Service',
};

const STATUS_LABEL: Record<MarketplaceStatus, string> = {
  active: 'Active',
  paused: 'Paused',
  expired: 'Expired',
  withdrawn: 'Withdrawn',
  completed: 'Completed',
};

const STATUS_STAMP: Record<MarketplaceStatus, StampKind> = {
  active: 'verified',
  paused: 'pending',
  expired: 'neutral',
  withdrawn: 'neutral',
  completed: 'info',
};

const words = (s: string) => s.replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase());

/** Field names of the inspected details, in plain words. */
const DETAIL_LABEL: Record<string, string> = {
  description: 'Description',
  product_name: 'Product',
  quantity: 'Quantity',
  quantity_sold: 'Sold so far',
  unit: 'Unit',
  price_ssp: 'Price (SSP)',
  price_per: 'Price per',
  price_unit: 'Price per',
  negotiable: 'Negotiable',
  quality_grade: 'Grade',
  min_order_quantity: 'Minimum order',
  available_from: 'Available from',
  harvest_season: 'Harvest season',
  pickup_notes: 'Pick-up notes',
  delivery_available: 'Delivery available',
  delivery_terms: 'Delivery terms',
  location: 'Location',
  payam: 'Payam',
  service_type: 'Service type',
  availability_note: 'Availability',
  show_phone: 'Phone shown to buyers',
};

const showValue = (value: AdminMarketplaceDetail['details'][string]) => {
  if (value === null || value === '') return '—';
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  if (Array.isArray(value)) return value.length ? `${value.length}` : 'None';
  return String(value);
};

interface Envelope<T> {
  data?: T;
  page?: { cursor: string | null; hasMore: boolean };
  error?: { message?: string; fields?: Record<string, string> };
}

async function getJson<T>(path: string): Promise<Envelope<T>> {
  let res: Response;
  try {
    res = await fetch(path, { cache: 'no-store' });
  } catch {
    throw new Error('The server could not be reached. Check the connection.');
  }
  const body = (await res.json().catch(() => ({}))) as Envelope<T>;
  if (!res.ok) {
    throw new Error(
      Object.values(body.error?.fields ?? {})[0] ??
        body.error?.message ??
        `Not loaded (${res.status}).`,
    );
  }
  return body;
}

export function MarketplaceConsole() {
  const toast = useToast();
  const query = useQueryState();
  const names = useLocationNames(true);
  useReasonCodes('listing');

  const tab = (
    (MARKETPLACE_TABS as readonly string[]).includes(query.get('tab'))
      ? query.get('tab')
      : 'produce'
  ) as MarketplaceTab;
  const q = query.get('q');
  // 'state' is the name the Overview's tiles carry.
  const stateId = query.get('state_id') || query.get('state');
  const category = query.get('category');
  const status = query.get('status');
  const kind = query.get('kind');
  const flag = query.get('flag');
  const removedView = tab === 'inactive' && status === 'removed';

  const [search, setSearch] = useState(q);
  const [inspecting, setInspecting] = useState<AdminMarketplaceDetail | null>(null);
  const [inspectError, setInspectError] = useState<string | null>(null);
  const [removing, setRemoving] = useState<AdminMarketplaceItem | null>(null);

  const filters = new URLSearchParams({ tab, limit: '25' });
  for (const [key, value] of Object.entries({
    q,
    state_id: stateId,
    category,
    flag,
    ...(tab === 'inactive' ? { status, kind } : {}),
  })) {
    if (value) filters.set(key, value);
  }
  const key = removedView ? 'removed' : filters.toString();

  const list = useCursorList<AdminMarketplaceItem>(async (cursor) => {
    const params = new URLSearchParams(filters);
    if (cursor) params.set('cursor', cursor);
    const body = await getJson<AdminMarketplaceItem[]>(`/api/admin/marketplace?${params}`);
    return {
      rows: body.data ?? [],
      cursor: body.page?.cursor ?? null,
      hasMore: !!body.page?.hasMore,
    };
  }, `list:${key}`);

  const removed = useCursorList<RemovedMarketplaceItem>(async (cursor) => {
    if (!removedView) return { rows: [], cursor: null, hasMore: false };
    const params = new URLSearchParams({ limit: '25' });
    if (cursor) params.set('cursor', cursor);
    const body = await getJson<RemovedMarketplaceItem[]>(
      `/api/admin/marketplace/removed?${params}`,
    );
    return {
      rows: body.data ?? [],
      cursor: body.page?.cursor ?? null,
      hasMore: !!body.page?.hasMore,
    };
  }, `removed:${key}`);

  const inspect = async (item: Pick<AdminMarketplaceItem, 'kind' | 'id'>) => {
    setInspectError(null);
    try {
      const body = await getJson<AdminMarketplaceDetail>(
        `/api/admin/marketplace/${item.kind}/${item.id}`,
      );
      if (body.data) setInspecting(body.data);
    } catch (e) {
      setInspectError(e instanceof Error ? e.message : 'The post could not be opened.');
    }
  };

  const categories =
    tab === 'services'
      ? SERVICE_TYPES.filter((t) => t !== 'other')
      : tab === 'inputs'
        ? []
        : LISTING_CATEGORIES.filter((c) => tab !== 'produce' || c !== 'seeds_inputs');

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--s-6)' }}>
      <PageHeader
        title="Marketplace"
        subtitle="Every published post: inspect it, ask its owner for a correction, or remove it with a reason."
      />
      <Notice kind="info">
        Listings and accounts have separate actions. Removing a post does not suspend or disable the
        account that posted it; do that from the account&apos;s own page.
      </Notice>

      <Tabs
        label="Kind of post"
        value={tab}
        onChange={(next) => query.set({ tab: next, status: null, kind: null, category: null })}
        items={MARKETPLACE_TABS.map((t) => ({ key: t, label: TAB_LABEL[t] }))}
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
              label="Search posts"
              placeholder="Search title, product or poster"
              maxLength={100}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </form>
        </FilterField>
        <Field label="Location">
          {(ids) => (
            <Select
              {...ids}
              value={stateId}
              onChange={(e) => query.set({ state_id: e.target.value || null })}
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
        {categories.length > 0 && tab !== 'inactive' ? (
          <Field label={tab === 'services' ? 'Service type' : 'Commodity'}>
            {(ids) => (
              <Select
                {...ids}
                value={category}
                onChange={(e) => query.set({ category: e.target.value || null })}
              >
                <option value="">All</option>
                {categories.map((c) => (
                  <option key={c} value={c}>
                    {words(c)}
                  </option>
                ))}
              </Select>
            )}
          </Field>
        ) : null}
        {tab === 'inactive' ? (
          <>
            <Field label="Status">
              {(ids) => (
                <Select
                  {...ids}
                  value={status}
                  onChange={(e) => query.set({ status: e.target.value || null })}
                >
                  <option value="">All inactive</option>
                  {INACTIVE_STATUSES.map((s) => (
                    <option key={s} value={s}>
                      {STATUS_LABEL[s]}
                    </option>
                  ))}
                  <option value="removed">Removed by staff</option>
                </Select>
              )}
            </Field>
            {!removedView ? (
              <Field label="Kind">
                {(ids) => (
                  <Select
                    {...ids}
                    value={kind}
                    onChange={(e) => query.set({ kind: e.target.value || null })}
                  >
                    <option value="">All kinds</option>
                    {MARKETPLACE_KINDS.map((k) => (
                      <option key={k} value={k}>
                        {KIND_LABEL[k]}
                      </option>
                    ))}
                  </Select>
                )}
              </Field>
            ) : null}
          </>
        ) : null}
        {!removedView ? (
          <Field label="Needs attention">
            {(ids) => (
              <Select
                {...ids}
                value={flag}
                onChange={(e) => query.set({ flag: e.target.value || null })}
              >
                <option value="">All posts</option>
                <option value="reported">Reported</option>
                <option value="correction">Correction requested</option>
              </Select>
            )}
          </Field>
        ) : null}
      </FilterBar>

      {inspectError ? <Notice kind="error">{inspectError}</Notice> : null}

      {removedView ? (
        <RemovedList list={removed} />
      ) : list.error ? (
        <EmptyState
          error
          title="Posts could not be loaded"
          body={list.error}
          actions={<Button onClick={list.reload}>Try again</Button>}
        />
      ) : list.loading ? (
        <LoadingState rows={5} />
      ) : (
        <>
          <DataTable<AdminMarketplaceItem>
            caption={`${TAB_LABEL[tab]} posts`}
            rows={list.rows}
            rowKey={(p) => `${p.kind}:${p.id}`}
            empty={
              <EmptyState
                title="No posts match"
                body="Change the filters, or choose another tab."
              />
            }
            columns={[
              {
                key: 'title',
                header: 'Title',
                rowHeader: true,
                render: (p) => (
                  <span dir="auto">
                    <strong>{p.title}</strong>
                    <br />
                    <span className="small muted">{KIND_LABEL[p.kind]}</span>
                  </span>
                ),
              },
              { key: 'category', header: 'Commodity / type', render: (p) => words(p.category) },
              { key: 'location', header: 'Location', render: (p) => p.state_name },
              {
                key: 'owner',
                header: 'Posted by',
                render: (p) => (
                  <span dir="auto">
                    {p.owner.id ? (
                      <Link href={`/admin/accounts/${p.owner.kind}/${p.owner.id}`}>
                        {p.owner.name}
                      </Link>
                    ) : (
                      p.owner.name
                    )}
                    {p.owner.suspended ? (
                      <>
                        {' '}
                        <Stamp kind="rejected">Account suspended</Stamp>
                      </>
                    ) : null}
                    {p.organization ? (
                      <>
                        <br />
                        <span className="small muted">for {p.organization.name}</span>
                      </>
                    ) : null}
                  </span>
                ),
              },
              {
                key: 'posted',
                header: 'Posted',
                nowrap: true,
                render: (p) => formatDate(p.created_at),
              },
              {
                key: 'status',
                header: 'Status',
                render: (p) => (
                  <span>
                    <Stamp kind={STATUS_STAMP[p.status]}>{STATUS_LABEL[p.status]}</Stamp>
                    {p.open_reports > 0 ? (
                      <>
                        {' '}
                        <Stamp kind="escalated">
                          {p.open_reports} report{p.open_reports === 1 ? '' : 's'}
                        </Stamp>
                      </>
                    ) : null}
                    {p.open_correction ? (
                      <>
                        {' '}
                        <Stamp kind="pending">Correction requested</Stamp>
                      </>
                    ) : null}
                  </span>
                ),
              },
              {
                key: 'actions',
                header: 'Actions',
                printHidden: true,
                render: (p) => (
                  <div style={{ display: 'flex', gap: 'var(--s-2)', flexWrap: 'wrap' }}>
                    <Button size="small" variant="secondary" onClick={() => void inspect(p)}>
                      Inspect
                    </Button>
                    {!p.open_correction ? (
                      <RequestCorrectionButton
                        targetType={p.kind}
                        targetId={p.id}
                        targetTitle={p.title}
                        onDone={() => list.reload()}
                      />
                    ) : null}
                    <Button size="small" variant="danger" onClick={() => setRemoving(p)}>
                      Remove
                    </Button>
                  </div>
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

      <InspectPanel
        post={inspecting}
        onClose={() => setInspecting(null)}
        onRemove={(p) => {
          setInspecting(null);
          setRemoving(p);
        }}
        onCorrected={() => list.reload()}
      />

      <RemoveDialog
        post={removing}
        onCancel={() => setRemoving(null)}
        onRemoved={(p, notified) => {
          setRemoving(null);
          toast.show({
            kind: 'success',
            title: `"${p.title}" removed from the market`,
            ...(notified ? {} : { body: 'The owner could not be sent a notice.' }),
          });
          list.reload();
        }}
      />
    </div>
  );
}

function RemovedList({ list }: { list: ReturnType<typeof useCursorList<RemovedMarketplaceItem>> }) {
  if (list.error) {
    return (
      <EmptyState
        error
        title="Removals could not be loaded"
        body={list.error}
        actions={<Button onClick={list.reload}>Try again</Button>}
      />
    );
  }
  if (list.loading) return <LoadingState rows={5} />;
  return (
    <>
      <p className="small muted">
        Removed posts are taken from the audit trail: the posts themselves are kept but never
        listed. A removal made from a report&apos;s queue records the post&apos;s identifier only.
      </p>
      <DataTable<RemovedMarketplaceItem>
        caption="Posts removed by staff"
        rows={list.rows}
        rowKey={(r) => r.audit_id}
        empty={<EmptyState title="No posts have been removed" body="Removals appear here." />}
        columns={[
          {
            key: 'title',
            header: 'Post',
            rowHeader: true,
            render: (r) => (
              <span dir="auto">
                <strong>{r.title ?? 'Title not recorded'}</strong>
                <br />
                <span className="small muted">{KIND_LABEL[r.kind]}</span>
              </span>
            ),
          },
          {
            key: 'reason',
            header: 'Reason',
            render: (r) => (
              <span dir="auto">
                {r.reason ?? (r.via === 'report' ? 'See the report’s decision' : '—')}
              </span>
            ),
          },
          {
            key: 'via',
            header: 'Removed from',
            render: (r) => (r.via === 'console' ? 'Marketplace console' : 'A report'),
          },
          { key: 'who', header: 'Removed by', render: (r) => r.removed_by ?? '—' },
          {
            key: 'when',
            header: 'When',
            nowrap: true,
            render: (r) => formatDate(r.removed_at),
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
  );
}

function InspectPanel({
  post,
  onClose,
  onRemove,
  onCorrected,
}: {
  post: AdminMarketplaceDetail | null;
  onClose: () => void;
  onRemove: (post: AdminMarketplaceItem) => void;
  onCorrected: () => void;
}) {
  const photos = Array.isArray(post?.details.photos) ? (post?.details.photos as string[]) : [];
  return (
    <Dialog
      open={post !== null}
      onClose={onClose}
      title={post ? post.title : 'Post'}
      footer={
        post ? (
          <>
            <Button variant="secondary" onClick={onClose}>
              Close
            </Button>
            {!post.open_correction ? (
              <RequestCorrectionButton
                targetType={post.kind}
                targetId={post.id}
                targetTitle={post.title}
                onDone={onCorrected}
              />
            ) : null}
            <Button variant="danger" onClick={() => onRemove(post)}>
              Remove
            </Button>
          </>
        ) : null
      }
    >
      {post ? (
        <div style={{ display: 'grid', gap: 'var(--s-4)' }}>
          <p>
            <Stamp kind={STATUS_STAMP[post.status]}>{STATUS_LABEL[post.status]}</Stamp>{' '}
            {KIND_LABEL[post.kind]} · {words(post.category)} · {post.state_name} · posted{' '}
            {formatDate(post.created_at)}
            {post.end_date
              ? ` · ${post.kind === 'buying_request' ? 'needed by' : 'until'} ${formatDate(post.end_date)}`
              : ''}
          </p>
          <p dir="auto">
            Posted by{' '}
            {post.owner.id ? (
              <Link href={`/admin/accounts/${post.owner.kind}/${post.owner.id}`}>
                {post.owner.name}
              </Link>
            ) : (
              post.owner.name
            )}
            {post.organization ? ` for ${post.organization.name}` : ''}
            {post.owner.suspended ? ' (account suspended)' : ''}
          </p>
          {/* The stored photo paths are not web addresses (no signed-link route
              exists for them here), so the console says how many there are and
              does not try to show them. */}
          {photos.length > 0 ? (
            <p className="small muted">
              {photos.length} photo{photos.length === 1 ? '' : 's'} attached. Open the post on the
              market to see them.
            </p>
          ) : null}
          <DefinitionList
            items={Object.entries(post.details)
              .filter(([k]) => k !== 'photos')
              .map(([k, v]) => ({
                term: DETAIL_LABEL[k] ?? words(k),
                value: <span dir="auto">{showValue(v)}</span>,
              }))}
          />
          <section>
            <h3>Reports ({post.reports.length})</h3>
            {post.reports.length === 0 ? (
              <p className="small muted">Nobody has reported this post.</p>
            ) : (
              <ul style={{ paddingInlineStart: 18 }}>
                {post.reports.map((r) => (
                  <li key={r.id} className="small">
                    {words(r.reason)} · {words(r.status)} · {formatDate(r.created_at)}
                    {r.description ? (
                      <>
                        <br />
                        <span dir="auto">{r.description}</span>
                      </>
                    ) : null}
                  </li>
                ))}
              </ul>
            )}
          </section>
          <section>
            <h3>Correction requests ({post.corrections.length})</h3>
            {post.corrections.length === 0 ? (
              <p className="small muted">No correction has been requested.</p>
            ) : (
              <ul style={{ paddingInlineStart: 18 }}>
                {post.corrections.map((c) => (
                  <li key={c.id} className="small">
                    {c.reason_label} · {c.status === 'open' ? 'Waiting for the owner' : 'Addressed'}{' '}
                    · requested {formatDate(c.requested_at)}
                    <br />
                    <span dir="auto">{c.note}</span>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      ) : null}
    </Dialog>
  );
}

function RemoveDialog({
  post,
  onCancel,
  onRemoved,
}: {
  post: AdminMarketplaceItem | null;
  onCancel: () => void;
  onRemoved: (post: AdminMarketplaceItem, ownerNotified: boolean) => void;
}) {
  const [reasonCode, setReasonCode] = useState('');
  const [reason, setReason] = useState('');
  const [prefill, setPrefill] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const { loading } = useReasonCodes('listing');

  const reset = () => {
    setReason('');
    setReasonCode('');
    setPrefill('');
    setError(null);
  };

  async function submit() {
    if (!post) return;
    const body = { reason: reason.trim(), ...(reasonCode ? { reason_code: reasonCode } : {}) };
    const parsed = marketplaceRemoveSchema.safeParse(body);
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? 'Give a reason.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/admin/marketplace/${post.kind}/${post.id}/remove`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
      const answer = (await res.json().catch(() => ({}))) as {
        data?: { owner_notified: boolean };
        error?: { message?: string; fields?: Record<string, string> };
      };
      if (!res.ok || !answer.data) {
        setError(
          Object.values(answer.error?.fields ?? {})[0] ??
            answer.error?.message ??
            `The post was not removed (${res.status}).`,
        );
        return;
      }
      reset();
      onRemoved(post, answer.data.owner_notified);
    } catch {
      setError('The server could not be reached. Nothing was removed.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <ConfirmationDialog
      open={post !== null}
      onCancel={() => {
        reset();
        onCancel();
      }}
      onConfirm={() => void submit()}
      title={post ? `Remove "${post.title}"?` : 'Remove post'}
      consequence="The post leaves the market for good and its owner is told, without the reason. The account that posted it is not affected. Your reason is kept in the audit trail."
      confirmLabel="Remove post"
      destructive
      busy={busy}
      confirmDisabled={loading}
    >
      {error ? <Notice kind="error">{error}</Notice> : null}
      <ReasonCodeSelect
        target="listing"
        value={reasonCode}
        onPick={(code, label) => {
          setReasonCode(code);
          const next = code ? `${label}: ` : '';
          if (reason.trim() === '' || reason === prefill) setReason(next);
          setPrefill(next);
        }}
      />
      <Field label="Reason" hint="At least five characters. Kept in the audit trail.">
        {(ids) => (
          <Textarea
            {...ids}
            rows={3}
            maxLength={500}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
          />
        )}
      </Field>
    </ConfirmationDialog>
  );
}
