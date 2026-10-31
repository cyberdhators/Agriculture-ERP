'use client';

import Link from 'next/link';
import { useState } from 'react';

import { PURCHASE_ORDER_STATUSES } from '@agri-erp/shared';

import { listOrders, type Order } from '@/lib/buyer/api';
import { ORDER_STATUS_STAMPS, formatSsp, stampOf } from '@/lib/buyer/labels';
import { formatDate } from '@/lib/format';
import { t } from '@/lib/i18n';

import { Button, EmptyState, Field, PageHeader, Select, Stamp } from '../ui';
import { DataTable, LoadingState, Pagination } from '../ui/data';
import { useBuyer } from './BuyerShell';
import { orderStatusIn, quantityIn } from './Timeline';
import { useCursorList } from './useCursorList';
import styles from './buyer.module.css';

/**
 * The organisation's orders (C-14B.12). Arranged by CORWADO against a listing;
 * the total is the agreed amount, computed by the database. No payment exists
 * in this system, and nothing here suggests one.
 */
export function BuyerOrders() {
  const { language } = useBuyer();
  const w = (key: Parameters<typeof t>[0]) => t(key, language);
  const [status, setStatus] = useState('');
  const list = useCursorList((cursor) => listOrders(status || undefined, cursor), status);

  return (
    <div className={styles.page}>
      <PageHeader title={w('buyer.orders.title')} subtitle={w('buyer.orders.subtitle')} />
      <div className={styles.filters}>
        <Field label={w('buyer.w.status')}>
          {(ids) => (
            <Select {...ids} value={status} onChange={(e) => setStatus(e.target.value)}>
              <option value="">{w('buyer.w.everyStatus')}</option>
              {PURCHASE_ORDER_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {orderStatusIn(s, language)}
                </option>
              ))}
            </Select>
          )}
        </Field>
      </div>

      {list.error ? (
        <EmptyState
          error
          title={w('buyer.orders.loadFailed')}
          body={list.error}
          actions={<Button onClick={list.reload}>{w('buyer.common.retry')}</Button>}
        />
      ) : list.loading ? (
        <LoadingState rows={5} label={w('buyer.common.loading')} />
      ) : (
        <>
          <DataTable<Order>
            caption={w('buyer.orders.title')}
            rows={list.rows}
            rowKey={(o) => o.id}
            empty={
              <EmptyState
                art="box"
                title={w(status ? 'buyer.orders.noneWithStatus' : 'buyer.orders.none')}
                body={status ? undefined : w('buyer.orders.noneBody')}
              />
            }
            columns={[
              {
                key: 'number',
                header: w('buyer.orders.order'),
                rowHeader: true,
                nowrap: true,
                render: (o) => (
                  <Link href={`/buyer/orders/${o.id}`} className="mono">
                    {o.order_number}
                  </Link>
                ),
              },
              { key: 'product', header: w('buyer.w.product'), render: (o) => o.product_name },
              {
                key: 'quantity',
                header: w('buyer.w.quantity'),
                numeric: true,
                render: (o) => quantityIn(o.quantity, o.unit, language),
              },
              {
                key: 'supplier',
                header: w('buyer.w.supplier'),
                render: (o) => <span dir="auto">{o.supplier.trading_name}</span>,
              },
              {
                key: 'price',
                header: w('buyer.w.unitPrice'),
                numeric: true,
                render: (o) => formatSsp(o.unit_price_ssp),
              },
              {
                key: 'total',
                header: w('buyer.orders.total'),
                numeric: true,
                render: (o) => formatSsp(o.total_ssp),
              },
              {
                key: 'status',
                header: w('buyer.w.status'),
                render: (o) => (
                  <Stamp kind={stampOf(ORDER_STATUS_STAMPS, o.status)}>
                    {orderStatusIn(o.status, language)}
                  </Stamp>
                ),
              },
              {
                key: 'date',
                header: w('buyer.orders.ordered'),
                nowrap: true,
                render: (o) => formatDate(o.order_date, language),
              },
              {
                key: 'expected',
                header: w('buyer.w.expected'),
                nowrap: true,
                render: (o) => o.expected_delivery_date ?? '—',
              },
              { key: 'to', header: w('buyer.w.deliverTo'), render: (o) => o.delivery_location },
            ]}
          />
          <Pagination
            shown={list.rows.length}
            hasMore={list.hasMore}
            onNext={list.goNext}
            onPrevious={list.goBack}
            canGoBack={list.canGoBack}
            language={language}
          />
        </>
      )}
    </div>
  );
}
