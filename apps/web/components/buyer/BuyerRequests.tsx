'use client';

import Link from 'next/link';
import { useState } from 'react';

import { PURCHASE_REQUEST_STATUSES } from '@agri-erp/shared';

import { listRequests, type PurchaseRequest } from '@/lib/buyer/api';
import { REQUEST_STATUS_STAMPS, stampOf } from '@/lib/buyer/labels';
import { formatDate, formatPhone } from '@/lib/format';
import { t } from '@/lib/i18n';

import { Button, ButtonLink, EmptyState, Field, PageHeader, Select, Stamp } from '../ui';
import { DataTable, LoadingState, Pagination } from '../ui/data';
import { useBuyer } from './BuyerShell';
import { quantityIn, requestStatusIn } from './Timeline';
import { useCursorList } from './useCursorList';
import styles from './buyer.module.css';

/** The organisation's purchase requests, newest first (C-14B.11, C-14B.18). */
export function BuyerRequests() {
  const { profile, language } = useBuyer();
  const w = (key: Parameters<typeof t>[0]) => t(key, language);
  const [status, setStatus] = useState('');
  const list = useCursorList((cursor) => listRequests(status || undefined, cursor), status);

  return (
    <div className={styles.page}>
      <PageHeader
        title={w('buyer.nav.myRequests')}
        actions={
          profile.verification.capabilities.browse ? (
            <ButtonLink href="/buyer/marketplace">{w('buyer.requests.find')}</ButtonLink>
          ) : null
        }
      />

      <div className={styles.filters}>
        <Field label={w('buyer.w.status')}>
          {(ids) => (
            <Select {...ids} value={status} onChange={(e) => setStatus(e.target.value)}>
              <option value="">{w('buyer.w.everyStatus')}</option>
              {PURCHASE_REQUEST_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {requestStatusIn(s, language)}
                </option>
              ))}
            </Select>
          )}
        </Field>
      </div>

      {list.error ? (
        <EmptyState
          error
          title={w('buyer.requests.loadFailed')}
          body={list.error}
          actions={<Button onClick={list.reload}>{w('buyer.common.retry')}</Button>}
        />
      ) : list.loading ? (
        <LoadingState rows={5} label={w('buyer.common.loading')} />
      ) : (
        <>
          <DataTable<PurchaseRequest>
            caption={w('buyer.requests.caption')}
            rows={list.rows}
            rowKey={(r) => r.id}
            empty={
              <EmptyState
                art="document"
                title={w(status ? 'buyer.requests.noneWithStatus' : 'buyer.requests.none')}
                body={status ? undefined : w('buyer.requests.noneBody')}
              />
            }
            columns={[
              {
                key: 'product',
                header: w('buyer.w.product'),
                rowHeader: true,
                render: (r) => (
                  <Link href={`/buyer/purchase-requests/${r.id}`} dir="auto">
                    {r.product_name}
                  </Link>
                ),
              },
              {
                key: 'quantity',
                header: w('buyer.w.quantity'),
                numeric: true,
                render: (r) => quantityIn(r.quantity, r.unit, language),
              },
              {
                key: 'farmerName',
                header: w('buyer.requests.farmer'),
                render: (r) => <span dir="auto">{r.farmer_name ?? '—'}</span>,
              },
              {
                key: 'farmer',
                header: w('buyer.requests.farmerPhone'),
                nowrap: true,
                render: (r) =>
                  r.farmer_phone ? (
                    <a href={`tel:${r.farmer_phone}`} className="mono" dir="ltr">
                      {formatPhone(r.farmer_phone)}
                    </a>
                  ) : (
                    '—'
                  ),
              },
              {
                key: 'deliver',
                header: w('buyer.w.deliverTo'),
                render: (r) => r.delivery_location,
              },
              {
                key: 'by',
                header: w('buyer.w.neededBy'),
                nowrap: true,
                render: (r) => r.required_by ?? '—',
              },
              {
                key: 'status',
                header: w('buyer.w.status'),
                render: (r) => (
                  <Stamp kind={stampOf(REQUEST_STATUS_STAMPS, r.status)}>
                    {requestStatusIn(r.status, language)}
                  </Stamp>
                ),
              },
              {
                key: 'created',
                header: w('buyer.request.raised'),
                nowrap: true,
                render: (r) => formatDate(r.created_at, language),
              },
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
