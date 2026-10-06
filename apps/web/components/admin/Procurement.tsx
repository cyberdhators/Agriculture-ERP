'use client';

import { useState } from 'react';

import {
  ORDER_TRANSITIONS,
  PURCHASE_ORDER_STATUSES,
  PURCHASE_REQUEST_STATUSES,
  REQUEST_DECISION_TRANSITIONS,
  createOrderSchema,
  zodErrorToApiError,
  type PurchaseOrderStatus,
  type PurchaseRequestStatus,
  type RequestDecision,
} from '@agri-erp/shared';

import {
  BuyerApiError,
  adminCreateOrder,
  adminDecideRequest,
  adminListOrders,
  adminListRequests,
  adminMoveOrder,
  type Order,
  type PurchaseRequest,
} from '@/lib/buyer/api';
import {
  ORDER_STATUS_LABELS,
  ORDER_STATUS_STAMPS,
  REQUEST_STATUS_LABELS,
  REQUEST_STATUS_STAMPS,
  formatQuantity,
  formatSsp,
  labelOf,
  stampOf,
} from '@/lib/buyer/labels';
import { formatDate } from '@/lib/format';

import { useCursorList } from '../buyer/useCursorList';
import {
  Button,
  Dialog,
  EmptyState,
  Field,
  Input,
  Notice,
  PageHeader,
  Select,
  Stamp,
  Tabs,
  Textarea,
} from '../ui';
import { DataTable, LoadingState, Pagination } from '../ui/data';
import { useToast } from '../ui/feedback';

/**
 * REQUESTS & ORDERS (B13, C-14B.11 to C-14B.13). Administrator only.
 *
 * Where a buyer's request becomes an order. CORWADO decides the request,
 * arranges an order against a listing at an agreed unit price, and records
 * the order's progress; each step notifies the buyer and is audited. No
 * payment is taken: the total is the agreed amount, computed by the database.
 */
type View = 'requests' | 'orders';

export function Procurement() {
  const [view, setView] = useState<View>('requests');
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--s-6)' }}>
      <PageHeader
        title="Requests & orders"
        subtitle="Decide buyers' purchase requests, arrange orders against listings, and record delivery progress."
      />
      <Tabs
        label="Requests or orders"
        value={view}
        onChange={setView}
        items={[
          { key: 'requests', label: 'Purchase requests' },
          { key: 'orders', label: 'Orders' },
        ]}
      />
      {view === 'requests' ? <Requests /> : <Orders />}
    </div>
  );
}

function Requests() {
  const toast = useToast();
  const [status, setStatus] = useState<string>('submitted');
  const list = useCursorList((cursor) => adminListRequests(status || undefined, cursor), status);
  const [ordering, setOrdering] = useState<PurchaseRequest | null>(null);

  // The decision statuses only: a reviewer never sets draft, submitted or cancelled.
  const decide = async (r: PurchaseRequest, to: RequestDecision['status']) => {
    const note =
      to === 'rejected'
        ? (window.prompt('Note to the buyer (why it was declined):') ?? undefined)
        : undefined;
    try {
      await adminDecideRequest(r.id, { status: to, ...(note ? { note } : {}) });
      toast.show({
        kind: 'success',
        title: `Request ${labelOf(REQUEST_STATUS_LABELS, to).toLowerCase()}`,
      });
      list.reload();
    } catch (e) {
      toast.show({ kind: 'error', title: 'Not saved', body: e instanceof Error ? e.message : '' });
    }
  };

  return (
    <>
      <Field label="Status">
        {(ids) => (
          <Select {...ids} value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="">Every status (except drafts)</option>
            {PURCHASE_REQUEST_STATUSES.filter((s) => s !== 'draft').map((s) => (
              <option key={s} value={s}>
                {REQUEST_STATUS_LABELS[s]}
              </option>
            ))}
          </Select>
        )}
      </Field>
      {list.error ? (
        <EmptyState error title="Requests could not be loaded" body={list.error} />
      ) : list.loading ? (
        <LoadingState rows={4} />
      ) : (
        <>
          <DataTable<PurchaseRequest>
            caption="Purchase requests"
            rows={list.rows}
            rowKey={(r) => r.id}
            empty={<EmptyState title="No requests here" body="Submitted requests arrive here." />}
            columns={[
              {
                key: 'org',
                header: 'Buyer',
                rowHeader: true,
                render: (r) => <span dir="auto">{r.organization?.name ?? '—'}</span>,
              },
              { key: 'product', header: 'Product', render: (r) => r.product_name },
              {
                key: 'qty',
                header: 'Quantity',
                numeric: true,
                render: (r) => formatQuantity(r.quantity, r.unit),
              },
              { key: 'to', header: 'Deliver to', render: (r) => r.delivery_location },
              { key: 'by', header: 'Needed by', nowrap: true, render: (r) => r.required_by ?? '—' },
              {
                key: 'listing',
                header: 'Listing',
                render: (r) => r.listing_title ?? 'Not tied to one',
              },
              {
                key: 'status',
                header: 'Status',
                render: (r) => (
                  <Stamp kind={stampOf(REQUEST_STATUS_STAMPS, r.status)}>
                    {labelOf(REQUEST_STATUS_LABELS, r.status)}
                  </Stamp>
                ),
              },
              {
                key: 'act',
                header: 'Decide',
                printHidden: true,
                render: (r) => (
                  <div style={{ display: 'flex', gap: 'var(--s-2)', flexWrap: 'wrap' }}>
                    {REQUEST_DECISION_TRANSITIONS[r.status as PurchaseRequestStatus].map((to) => (
                      <Button
                        key={to}
                        size="small"
                        variant="secondary"
                        onClick={() => void decide(r, to as RequestDecision['status'])}
                      >
                        {labelOf(REQUEST_STATUS_LABELS, to)}
                      </Button>
                    ))}
                    {r.status === 'accepted' || r.status === 'partially_fulfilled' ? (
                      <Button size="small" onClick={() => setOrdering(r)}>
                        Arrange order
                      </Button>
                    ) : null}
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
      {ordering ? (
        <ArrangeOrder
          request={ordering}
          onClose={() => setOrdering(null)}
          onDone={() => {
            setOrdering(null);
            list.reload();
          }}
        />
      ) : null}
    </>
  );
}

/** Arranges one order for an accepted request, against a listing. */
function ArrangeOrder({
  request,
  onClose,
  onDone,
}: {
  request: PurchaseRequest;
  onClose: () => void;
  onDone: () => void;
}) {
  const toast = useToast();
  const [form, setForm] = useState({
    listing_id: request.listing_id ?? '',
    quantity: String(request.quantity),
    unit_price_ssp: '',
    delivery_location: request.delivery_location,
    expected_delivery_date: '',
  });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [failure, setFailure] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const set = (k: keyof typeof form) => (v: string) => setForm((f) => ({ ...f, [k]: v }));

  const submit = async () => {
    setFailure(null);
    const parsed = createOrderSchema.safeParse({
      organization_id: request.organization?.id,
      purchase_request_id: request.id,
      listing_id: form.listing_id.trim(),
      quantity: Number(form.quantity),
      unit_price_ssp: form.unit_price_ssp.trim() === '' ? Number.NaN : Number(form.unit_price_ssp),
      delivery_location: form.delivery_location,
      ...(form.expected_delivery_date
        ? { expected_delivery_date: form.expected_delivery_date }
        : {}),
    });
    if (!parsed.success) {
      setErrors(zodErrorToApiError(parsed.error).body.error.fields ?? {});
      return;
    }
    setErrors({});
    setBusy(true);
    try {
      const order = await adminCreateOrder(parsed.data);
      toast.show({
        kind: 'success',
        title: `Order ${order.order_number} arranged`,
        body: formatSsp(order.total_ssp),
      });
      onDone();
    } catch (e) {
      if (e instanceof BuyerApiError) setErrors(e.fields);
      setFailure(e instanceof Error ? e.message : 'The order was not arranged.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog
      open
      onClose={onClose}
      title={`Arrange an order — ${request.product_name}`}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button onClick={() => void submit()} disabled={busy}>
            {busy ? 'Arranging…' : 'Arrange order'}
          </Button>
        </>
      }
    >
      <p className="small muted">
        For {request.organization?.name}. The product, category, unit and supplier come from the
        listing; the total is computed when the order is saved.
      </p>
      {failure ? <Notice kind="error">{failure}</Notice> : null}
      <Field
        label="Listing identifier"
        hint={
          request.listing_id
            ? 'The listing the buyer requested from.'
            : 'Open the listing in the marketplace and copy its id from the address.'
        }
        error={errors.listing_id}
      >
        {(ids) => (
          <Input
            {...ids}
            className="mono"
            value={form.listing_id}
            onChange={(e) => set('listing_id')(e.target.value)}
          />
        )}
      </Field>
      <Field label="Quantity" error={errors.quantity}>
        {(ids) => (
          <Input
            {...ids}
            inputMode="decimal"
            value={form.quantity}
            onChange={(e) => set('quantity')(e.target.value)}
          />
        )}
      </Field>
      <Field label="Agreed unit price (SSP)" error={errors.unit_price_ssp}>
        {(ids) => (
          <Input
            {...ids}
            inputMode="decimal"
            value={form.unit_price_ssp}
            onChange={(e) => set('unit_price_ssp')(e.target.value)}
          />
        )}
      </Field>
      <Field label="Deliver to" error={errors.delivery_location}>
        {(ids) => (
          <Input
            {...ids}
            value={form.delivery_location}
            onChange={(e) => set('delivery_location')(e.target.value)}
          />
        )}
      </Field>
      <Field label="Expected delivery" optional error={errors.expected_delivery_date}>
        {(ids) => (
          <Input
            {...ids}
            type="date"
            value={form.expected_delivery_date}
            onChange={(e) => set('expected_delivery_date')(e.target.value)}
          />
        )}
      </Field>
    </Dialog>
  );
}

function Orders() {
  const toast = useToast();
  const [status, setStatus] = useState('');
  const list = useCursorList((cursor) => adminListOrders(status || undefined, cursor), status);
  const [moving, setMoving] = useState<{ order: Order; to: PurchaseOrderStatus } | null>(null);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);

  const move = async () => {
    if (!moving) return;
    setBusy(true);
    try {
      await adminMoveOrder(moving.order.id, {
        status: moving.to,
        ...(note.trim() ? { note: note.trim() } : {}),
      });
      toast.show({
        kind: 'success',
        title: `${moving.order.order_number}: ${ORDER_STATUS_LABELS[moving.to]}`,
      });
      setMoving(null);
      setNote('');
      list.reload();
    } catch (e) {
      toast.show({ kind: 'error', title: 'Not saved', body: e instanceof Error ? e.message : '' });
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <Field label="Status">
        {(ids) => (
          <Select {...ids} value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="">Every status</option>
            {PURCHASE_ORDER_STATUSES.map((s) => (
              <option key={s} value={s}>
                {ORDER_STATUS_LABELS[s]}
              </option>
            ))}
          </Select>
        )}
      </Field>
      {list.error ? (
        <EmptyState error title="Orders could not be loaded" body={list.error} />
      ) : list.loading ? (
        <LoadingState rows={4} />
      ) : (
        <>
          <DataTable<Order>
            caption="Orders"
            rows={list.rows}
            rowKey={(o) => o.id}
            empty={
              <EmptyState title="No orders here" body="Arrange one from an accepted request." />
            }
            columns={[
              {
                key: 'n',
                header: 'Order',
                rowHeader: true,
                nowrap: true,
                render: (o) => <span className="mono">{o.order_number}</span>,
              },
              {
                key: 'org',
                header: 'Buyer',
                render: (o) => <span dir="auto">{o.organization?.name ?? '—'}</span>,
              },
              { key: 'p', header: 'Product', render: (o) => o.product_name },
              {
                key: 'q',
                header: 'Quantity',
                numeric: true,
                render: (o) => formatQuantity(o.quantity, o.unit),
              },
              { key: 't', header: 'Total', numeric: true, render: (o) => formatSsp(o.total_ssp) },
              {
                key: 'd',
                header: 'Ordered',
                nowrap: true,
                render: (o) => formatDate(o.order_date),
              },
              {
                key: 's',
                header: 'Status',
                render: (o) => (
                  <Stamp kind={stampOf(ORDER_STATUS_STAMPS, o.status)}>
                    {labelOf(ORDER_STATUS_LABELS, o.status)}
                  </Stamp>
                ),
              },
              {
                key: 'a',
                header: 'Record progress',
                printHidden: true,
                render: (o) => (
                  <div style={{ display: 'flex', gap: 'var(--s-2)', flexWrap: 'wrap' }}>
                    {ORDER_TRANSITIONS[o.status as PurchaseOrderStatus].map((to) => (
                      <Button
                        key={to}
                        size="small"
                        variant={to === 'cancelled' ? 'secondary' : 'primary'}
                        onClick={() => {
                          setMoving({ order: o, to });
                          setNote('');
                        }}
                      >
                        {ORDER_STATUS_LABELS[to]}
                      </Button>
                    ))}
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
      <Dialog
        open={moving !== null}
        onClose={() => setMoving(null)}
        title={
          moving
            ? `${moving.order.order_number}: mark ${ORDER_STATUS_LABELS[moving.to].toLowerCase()}?`
            : ''
        }
        footer={
          <>
            <Button variant="secondary" onClick={() => setMoving(null)} disabled={busy}>
              Cancel
            </Button>
            <Button onClick={() => void move()} disabled={busy}>
              {busy ? 'Saving…' : 'Record'}
            </Button>
          </>
        }
      >
        <p>The buyer is notified and sees this in the order&apos;s delivery history.</p>
        <Field label="Note" optional hint="Shown to the buyer, e.g. truck left Yei at 08:00.">
          {(ids) => (
            <Textarea
              {...ids}
              rows={3}
              maxLength={500}
              value={note}
              onChange={(e) => setNote(e.target.value)}
            />
          )}
        </Field>
      </Dialog>
    </>
  );
}
