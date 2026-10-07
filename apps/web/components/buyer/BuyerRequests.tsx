'use client';

import Link from 'next/link';
import { useState } from 'react';

import { PURCHASE_REQUEST_STATUSES } from '@agri-erp/shared';

import { listRequests, type PurchaseRequest } from '@/lib/buyer/api';
import {
  REQUEST_STATUS_LABELS,
  REQUEST_STATUS_STAMPS,
  formatQuantity,
  labelOf,
  stampOf,
} from '@/lib/buyer/labels';
import { formatDate, formatPhone } from '@/lib/format';

import { Button, ButtonLink, EmptyState, Field, PageHeader, Select, Stamp } from '../ui';
import { DataTable, LoadingState, Pagination } from '../ui/data';
import { useBuyer } from './BuyerShell';
import { useCursorList } from './useCursorList';
import styles from './buyer.module.css';

/** The organisation's purchase requests, newest first (C-14B.11, C-14B.18). */
export function BuyerRequests() {
  const { profile } = useBuyer();
  const [status, setStatus] = useState('');
  const list = useCursorList((cursor) => listRequests(status || undefined, cursor), status);

  return (
    <div className={styles.page}>
      <PageHeader
        title="My requests"
        subtitle="What you have asked farmers for, and each farmer's answer. Call or message the farmer to agree the price and the handover."
        actions={
          profile.verification.capabilities.browse ? (
            <ButtonLink href="/buyer/marketplace">Find products</ButtonLink>
          ) : null
        }
      />

      <div className={styles.filters}>
        <Field label="Status">
          {(ids) => (
            <Select {...ids} value={status} onChange={(e) => setStatus(e.target.value)}>
              <option value="">Every status</option>
              {PURCHASE_REQUEST_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {REQUEST_STATUS_LABELS[s]}
                </option>
              ))}
            </Select>
          )}
        </Field>
      </div>

      {list.error ? (
        <EmptyState
          error
          title="Requests could not be loaded"
          body={list.error}
          actions={<Button onClick={list.reload}>Try again</Button>}
        />
      ) : list.loading ? (
        <LoadingState rows={5} />
      ) : (
        <>
          <DataTable<PurchaseRequest>
            caption="Purchase requests"
            rows={list.rows}
            rowKey={(r) => r.id}
            empty={
              <EmptyState
                title={status ? 'No requests with this status' : 'No purchase requests yet'}
                body="Add products to your cart from the marketplace and send them to the farmers."
              />
            }
            columns={[
              {
                key: 'product',
                header: 'Product',
                rowHeader: true,
                render: (r) => (
                  <Link href={`/buyer/purchase-requests/${r.id}`} dir="auto">
                    {r.product_name}
                  </Link>
                ),
              },
              {
                key: 'quantity',
                header: 'Quantity',
                numeric: true,
                render: (r) => formatQuantity(r.quantity, r.unit),
              },
              {
                key: 'farmer',
                header: "Farmer's phone",
                nowrap: true,
                render: (r) =>
                  r.farmer_phone ? (
                    <a href={`tel:${r.farmer_phone}`} className="mono">
                      {formatPhone(r.farmer_phone)}
                    </a>
                  ) : (
                    '—'
                  ),
              },
              { key: 'deliver', header: 'Deliver to', render: (r) => r.delivery_location },
              {
                key: 'by',
                header: 'Needed by',
                nowrap: true,
                render: (r) => r.required_by ?? '—',
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
                key: 'created',
                header: 'Raised',
                nowrap: true,
                render: (r) => formatDate(r.created_at),
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
    </div>
  );
}
