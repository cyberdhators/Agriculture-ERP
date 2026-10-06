'use client';

import Link from 'next/link';

import { listDeliveries } from '@/lib/buyer/api';
import {
  ORDER_STATUS_LABELS,
  ORDER_STATUS_STAMPS,
  formatQuantity,
  labelOf,
  stampOf,
} from '@/lib/buyer/labels';

import {
  Button,
  Card,
  CardBody,
  CardHeader,
  DefinitionList,
  EmptyState,
  PageHeader,
  Stamp,
} from '../ui';
import { LoadingState, Pagination } from '../ui/data';
import { Timeline } from './Timeline';
import { useCursorList } from './useCursorList';
import styles from './buyer.module.css';

/**
 * DELIVERIES (C-14B.13). Orders whose goods are ready, moving or arrived,
 * each with what CORWADO last recorded. This is not live tracking -- there is
 * no GPS in this system -- and the page says when each status was recorded
 * rather than implying a position.
 */
export function BuyerDeliveries() {
  const list = useCursorList((cursor) => listDeliveries(cursor), 'deliveries');

  return (
    <div className={styles.page}>
      <PageHeader
        title="Deliveries"
        subtitle="Orders that are ready, on the way or delivered. Statuses are recorded by CORWADO; there is no live tracking."
      />
      {list.error ? (
        <EmptyState
          error
          title="Deliveries could not be loaded"
          body={list.error}
          actions={<Button onClick={list.reload}>Try again</Button>}
        />
      ) : list.loading ? (
        <LoadingState rows={5} />
      ) : list.rows.length === 0 ? (
        <EmptyState
          title="Nothing is being delivered"
          body="An order appears here once CORWADO marks it ready for delivery."
        />
      ) : (
        <>
          {list.rows.map((o) => (
            <Card key={o.id}>
              <CardHeader
                title={
                  <Link href={`/buyer/orders/${o.id}`}>
                    {o.product_name} · <span className="mono">{o.order_number}</span>
                  </Link>
                }
                actions={
                  <Stamp kind={stampOf(ORDER_STATUS_STAMPS, o.status)}>
                    {labelOf(ORDER_STATUS_LABELS, o.status)}
                  </Stamp>
                }
              />
              <CardBody>
                <div className={styles.twoCol}>
                  <DefinitionList
                    items={[
                      { term: 'Quantity', value: formatQuantity(o.quantity, o.unit) },
                      { term: 'Supplier', value: o.supplier.trading_name },
                      { term: 'Deliver to', value: o.delivery_location },
                      { term: 'Expected', value: o.expected_delivery_date ?? 'Not yet set' },
                      { term: 'Latest note', value: o.latest_note ?? '—' },
                    ]}
                  />
                  <Timeline entries={o.timeline ?? []} />
                </div>
              </CardBody>
            </Card>
          ))}
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
