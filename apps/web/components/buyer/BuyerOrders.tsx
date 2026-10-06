'use client';

import Link from 'next/link';
import { useState } from 'react';

import { PURCHASE_ORDER_STATUSES } from '@agri-erp/shared';

import { listOrders, type Order } from '@/lib/buyer/api';
import {
  ORDER_STATUS_LABELS,
  ORDER_STATUS_STAMPS,
  formatQuantity,
  formatSsp,
  labelOf,
  stampOf,
} from '@/lib/buyer/labels';
import { formatDate } from '@/lib/format';

import { Button, EmptyState, Field, PageHeader, Select, Stamp } from '../ui';
import { DataTable, LoadingState, Pagination } from '../ui/data';
import { useCursorList } from './useCursorList';
import styles from './buyer.module.css';

/**
 * The organisation's orders (C-14B.12). Arranged by CORWADO against a listing;
 * the total is the agreed amount, computed by the database. No payment exists
 * in this system, and nothing here suggests one.
 */
export function BuyerOrders() {
  const [status, setStatus] = useState('');
  const list = useCursorList((cursor) => listOrders(status || undefined, cursor), status);

  return (
    <div className={styles.page}>
      <PageHeader
        title="Orders"
        subtitle="Orders CORWADO has arranged for your organisation. Totals are agreed amounts; no payment is taken here."
      />
      <div className={styles.filters}>
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
      </div>

      {list.error ? (
        <EmptyState
          error
          title="Orders could not be loaded"
          body={list.error}
          actions={<Button onClick={list.reload}>Try again</Button>}
        />
      ) : list.loading ? (
        <LoadingState rows={5} />
      ) : (
        <>
          <DataTable<Order>
            caption="Orders"
            rows={list.rows}
            rowKey={(o) => o.id}
            empty={
              <EmptyState
                title={status ? 'No orders with this status' : 'No orders yet'}
                body="Orders appear here once CORWADO accepts a request and arranges supply."
              />
            }
            columns={[
              {
                key: 'number',
                header: 'Order',
                rowHeader: true,
                nowrap: true,
                render: (o) => (
                  <Link href={`/buyer/orders/${o.id}`} className="mono">
                    {o.order_number}
                  </Link>
                ),
              },
              { key: 'product', header: 'Product', render: (o) => o.product_name },
              {
                key: 'quantity',
                header: 'Quantity',
                numeric: true,
                render: (o) => formatQuantity(o.quantity, o.unit),
              },
              {
                key: 'supplier',
                header: 'Supplier',
                render: (o) => <span dir="auto">{o.supplier.trading_name}</span>,
              },
              {
                key: 'price',
                header: 'Unit price',
                numeric: true,
                render: (o) => formatSsp(o.unit_price_ssp),
              },
              {
                key: 'total',
                header: 'Total',
                numeric: true,
                render: (o) => formatSsp(o.total_ssp),
              },
              {
                key: 'status',
                header: 'Status',
                render: (o) => (
                  <Stamp kind={stampOf(ORDER_STATUS_STAMPS, o.status)}>
                    {labelOf(ORDER_STATUS_LABELS, o.status)}
                  </Stamp>
                ),
              },
              {
                key: 'date',
                header: 'Ordered',
                nowrap: true,
                render: (o) => formatDate(o.order_date),
              },
              {
                key: 'expected',
                header: 'Expected',
                nowrap: true,
                render: (o) => o.expected_delivery_date ?? '—',
              },
              { key: 'to', header: 'Deliver to', render: (o) => o.delivery_location },
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
