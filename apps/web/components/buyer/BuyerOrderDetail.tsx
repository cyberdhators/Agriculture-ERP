'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';

import { buyerMayCancelOrder, type PurchaseOrderStatus } from '@agri-erp/shared';

import { BuyerApiError, cancelOrder, getOrder, type Order } from '@/lib/buyer/api';
import { ORDER_STATUS_STAMPS, categoryLabelOf, formatSsp, stampOf } from '@/lib/buyer/labels';
import { formatDate } from '@/lib/format';
import { t } from '@/lib/i18n';

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
import { useBuyer } from './BuyerShell';
import { Timeline, orderStatusIn, quantityIn } from './Timeline';
import styles from './buyer.module.css';
import { DirArrow } from '@/components/ui/icons';

/**
 * ONE ORDER (C-14B.12, C-14B.13). The buyer may cancel it, with a reason,
 * while it is still pending; once confirmed a farmer has set produce aside and
 * any change goes through CORWADO. The route enforces that; this page offers
 * the button only when it would succeed.
 */
export function BuyerOrderDetail({ id }: { id: string }) {
  const toast = useToast();
  const { language } = useBuyer();
  const w = (key: Parameters<typeof t>[0]) => t(key, language);
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
      toast.show({ kind: 'success', title: w('buyer.order.cancelled') });
    } catch (e) {
      setFailure(e instanceof Error ? e.message : w('buyer.order.notCancelled'));
    } finally {
      setBusy(false);
    }
  };

  if (state === 'loading') return <LoadingState rows={6} label={w('buyer.common.loading')} />;
  if (state !== 'ready' || !order) {
    return (
      <EmptyState
        error={state === 'error'}
        title={w(state === 'missing' ? 'buyer.order.notFound' : 'buyer.order.loadFailed')}
        body={w('buyer.w.notFoundBody')}
        actions={<Link href="/buyer/orders">{w('buyer.order.back')}</Link>}
      />
    );
  }

  const canCancel = buyerMayCancelOrder(order.status as PurchaseOrderStatus);

  return (
    <div className={styles.page}>
      <Link href="/buyer/orders" className="small">
        <DirArrow back /> {w('buyer.orders.title')}
      </Link>
      <PageHeader
        eyebrow={w('buyer.order.eyebrow').replace('{number}', order.order_number)}
        title={order.product_name}
        subtitle={
          <Stamp kind={stampOf(ORDER_STATUS_STAMPS, order.status)}>
            {orderStatusIn(order.status, language)}
          </Stamp>
        }
        actions={
          canCancel ? (
            <Button variant="secondary" onClick={() => setConfirm(true)}>
              {w('buyer.order.cancel')}
            </Button>
          ) : null
        }
      />
      {order.cancel_reason ? (
        <Notice kind="warn" title={w('buyer.order.cancelledNotice')}>
          {order.cancel_reason}
        </Notice>
      ) : null}

      <div className={styles.twoCol}>
        <Card>
          {/* 2026-10-31: the number is the page's eyebrow; not said twice. */}
          <CardHeader title={w('buyer.w.details')} />
          <CardBody>
            <DefinitionList
              items={[
                { term: w('buyer.w.category'), value: categoryLabelOf(order.category, language) },
                {
                  term: w('buyer.w.quantity'),
                  value: quantityIn(order.quantity, order.unit, language),
                },
                { term: w('buyer.w.unitPrice'), value: formatSsp(order.unit_price_ssp) },
                { term: w('buyer.order.total'), value: formatSsp(order.total_ssp) },
                {
                  term: w('buyer.w.supplier'),
                  value: `${order.supplier.trading_name} — ${order.supplier.county}, ${order.supplier.state}`,
                },
                { term: w('buyer.order.date'), value: formatDate(order.order_date, language) },
                {
                  term: w('buyer.order.expectedDelivery'),
                  value: order.expected_delivery_date ?? w('buyer.w.notYetSet'),
                },
                { term: w('buyer.w.deliverTo'), value: order.delivery_location },
                {
                  term: w('buyer.order.fromRequest'),
                  value: order.purchase_request_id ? (
                    <Link href={`/buyer/purchase-requests/${order.purchase_request_id}`}>
                      {w('buyer.order.openRequest')}
                    </Link>
                  ) : (
                    w('buyer.order.direct')
                  ),
                },
              ]}
            />
          </CardBody>
        </Card>
        <Card>
          <CardHeader title={w('buyer.order.history')} />
          <CardBody>
            <Timeline entries={order.timeline ?? []} language={language} />
          </CardBody>
        </Card>
      </div>

      <ConfirmationDialog
        open={confirm}
        onCancel={() => setConfirm(false)}
        onConfirm={() => void cancel()}
        title={w('buyer.order.confirmTitle')}
        consequence={w('buyer.order.confirmBody')}
        confirmLabel={w('buyer.order.cancel')}
        destructive
        busy={busy || reason.trim().length < 2}
      >
        {failure ? <Notice kind="error">{failure}</Notice> : null}
        <Field label={w('buyer.order.reason')} hint={w('buyer.order.reasonHint')}>
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
