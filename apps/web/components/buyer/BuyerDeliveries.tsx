'use client';

import Link from 'next/link';

import { listDeliveries } from '@/lib/buyer/api';
import { ORDER_STATUS_STAMPS, stampOf } from '@/lib/buyer/labels';
import { t } from '@/lib/i18n';

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
import { useBuyer } from './BuyerShell';
import { Timeline, orderStatusIn, quantityIn } from './Timeline';
import { useCursorList } from './useCursorList';
import styles from './buyer.module.css';

/**
 * DELIVERIES (C-14B.13). Orders whose goods are ready, moving or arrived,
 * each with what CORWADO last recorded. This is not live tracking -- there is
 * no GPS in this system -- and the page says when each status was recorded
 * rather than implying a position.
 */
export function BuyerDeliveries() {
  const { language } = useBuyer();
  const w = (key: Parameters<typeof t>[0]) => t(key, language);
  const list = useCursorList((cursor) => listDeliveries(cursor), 'deliveries');

  return (
    <div className={styles.page}>
      {/* 2026-10-31: the title alone; each status names who recorded it, and when. */}
      <PageHeader title={w('buyer.deliveries.title')} />
      {list.error ? (
        <EmptyState
          error
          title={w('buyer.deliveries.loadFailed')}
          body={list.error}
          actions={<Button onClick={list.reload}>{w('buyer.common.retry')}</Button>}
        />
      ) : list.loading ? (
        <LoadingState rows={5} label={w('buyer.common.loading')} />
      ) : list.rows.length === 0 ? (
        <EmptyState
          art="box"
          title={w('buyer.deliveries.none')}
          body={w('buyer.deliveries.noneBody')}
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
                    {orderStatusIn(o.status, language)}
                  </Stamp>
                }
              />
              <CardBody>
                <div className={styles.twoCol}>
                  <DefinitionList
                    items={[
                      {
                        term: w('buyer.w.quantity'),
                        value: quantityIn(o.quantity, o.unit, language),
                      },
                      { term: w('buyer.w.supplier'), value: o.supplier.trading_name },
                      { term: w('buyer.w.deliverTo'), value: o.delivery_location },
                      {
                        term: w('buyer.w.expected'),
                        value: o.expected_delivery_date ?? w('buyer.w.notYetSet'),
                      },
                      { term: w('buyer.deliveries.latestNote'), value: o.latest_note ?? '—' },
                    ]}
                  />
                  <Timeline entries={o.timeline ?? []} language={language} />
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
            language={language}
          />
        </>
      )}
    </div>
  );
}
