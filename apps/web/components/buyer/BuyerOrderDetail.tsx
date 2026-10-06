'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';

import { buyerMayCancelOrder, type PurchaseOrderStatus } from '@agri-erp/shared';

import { BuyerApiError, cancelOrder, getOrder, type Order } from '@/lib/buyer/api';
import {
  CATEGORY_LABELS,
  ORDER_STATUS_LABELS,
  ORDER_STATUS_STAMPS,
  formatQuantity,
  formatSsp,
  labelOf,
  stampOf,
} from '@/lib/buyer/labels';
import { formatDate } from '@/lib/format';

import {
  Button,
  Card,
  CardBody,
  CardHeader,
  DefinitionList,
  EmptyState,
  Field,
  Notice,
  PageHeader,
  Stamp,
  Textarea,
} from '../ui';
import { LoadingState } from '../ui/data';
import { ConfirmationDialog, useToast } from '../ui/feedback';
import { Timeline } from './Timeline';
import styles from './buyer.module.css';

/**
 * ONE ORDER (C-14B.12, C-14B.13). The buyer may cancel it, with a reason,
 * while it is still pending; once confirmed a farmer has set produce aside and
 * any change goes through CORWADO. The route enforces that; this page offers
 * the button only when it would succeed.
 */
export function BuyerOrderDetail({ id }: { id: string }) {
  const toast = useToast();
  const [order, setOrder] = useState<Order | null>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'missing' | 'error'>('loading');
  const [confirm, setConfirm] = useState(false);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);

  const load = useCallback(() => {
    getOrder(id)
      .then((o) => {
        setOrder(o);
        setState('ready');
      })
      .catch((e: unknown) =>
        setState(e instanceof BuyerApiError && e.status === 404 ? 'missing' : 'error'),
      );
  }, [id]);
  useEffect(load, [load]);

  const cancel = async () => {
    setBusy(true);
    setFailure(null);
    try {
      setOrder(await cancelOrder(id, reason));
      setConfirm(false);
      toast.show({ kind: 'success', title: 'Order cancelled' });
    } catch (e) {
      setFailure(e instanceof Error ? e.message : 'The order was not cancelled.');
    } finally {
      setBusy(false);
    }
  };

  if (state === 'loading') return <LoadingState rows={6} />;
  if (state !== 'ready' || !order) {
    return (
      <EmptyState
        error={state === 'error'}
        title={state === 'missing' ? 'Order not found' : 'The order could not be loaded'}
        body="It may belong to another organisation, or not exist."
        actions={<Link href="/buyer/orders">Back to orders</Link>}
      />
    );
  }

  const canCancel = buyerMayCancelOrder(order.status as PurchaseOrderStatus);

  return (
    <div className={styles.page}>
      <Link href="/buyer/orders" className="small">
        ← Orders
      </Link>
      <PageHeader
        eyebrow={`Order ${order.order_number}`}
        title={order.product_name}
        subtitle={
          <Stamp kind={stampOf(ORDER_STATUS_STAMPS, order.status)}>
            {labelOf(ORDER_STATUS_LABELS, order.status)}
          </Stamp>
        }
        actions={
          canCancel ? (
            <Button variant="secondary" onClick={() => setConfirm(true)}>
              Cancel order
            </Button>
          ) : null
        }
      />
      {order.cancel_reason ? (
        <Notice kind="warn" title="Cancelled">
          {order.cancel_reason}
        </Notice>
      ) : null}

      <div className={styles.twoCol}>
        <Card>
          <CardHeader title="Order" />
          <CardBody>
            <DefinitionList
              items={[
                { term: 'Order number', value: <span className="mono">{order.order_number}</span> },
                { term: 'Category', value: labelOf(CATEGORY_LABELS, order.category) },
                { term: 'Quantity', value: formatQuantity(order.quantity, order.unit) },
                { term: 'Unit price', value: formatSsp(order.unit_price_ssp) },
                { term: 'Total (agreed)', value: formatSsp(order.total_ssp) },
                {
                  term: 'Supplier',
                  value: `${order.supplier.trading_name} — ${order.supplier.county}, ${order.supplier.state}`,
                },
                { term: 'Order date', value: formatDate(order.order_date) },
                { term: 'Expected delivery', value: order.expected_delivery_date ?? 'Not yet set' },
                { term: 'Deliver to', value: order.delivery_location },
                {
                  term: 'From request',
                  value: order.purchase_request_id ? (
                    <Link href={`/buyer/purchase-requests/${order.purchase_request_id}`}>
                      Open the request
                    </Link>
                  ) : (
                    'Arranged directly'
                  ),
                },
              ]}
            />
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="Delivery history" subtitle="What CORWADO recorded, and when" />
          <CardBody>
            <Timeline entries={order.timeline ?? []} />
          </CardBody>
        </Card>
      </div>

      <ConfirmationDialog
        open={confirm}
        onCancel={() => setConfirm(false)}
        onConfirm={() => void cancel()}
        title="Cancel this order?"
        consequence="CORWADO and the supplier will be told the order is off. This cannot be undone; a new order would need a new request."
        confirmLabel="Cancel order"
        destructive
        busy={busy || reason.trim().length < 2}
      >
        {failure ? <Notice kind="error">{failure}</Notice> : null}
        <Field label="Reason" hint="Kept on the order, so CORWADO knows why.">
          {(ids) => (
            <Textarea
              {...ids}
              rows={3}
              maxLength={300}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
            />
          )}
        </Field>
      </ConfirmationDialog>
    </div>
  );
}
