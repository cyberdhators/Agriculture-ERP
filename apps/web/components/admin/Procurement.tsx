'use client';

import { useState } from 'react';

import { PURCHASE_REQUEST_STATUSES } from '@agri-erp/shared';

import { adminListRequests, type PurchaseRequest } from '@/lib/buyer/api';
import {
  REQUEST_STATUS_LABELS,
  REQUEST_STATUS_STAMPS,
  formatQuantity,
  labelOf,
  stampOf,
} from '@/lib/buyer/labels';
import { formatPhone } from '@/lib/format';

import { useCursorList } from '../buyer/useCursorList';
import { EmptyState, Field, PageHeader, Select, Stamp } from '../ui';
import { DataTable, LoadingState, Pagination } from '../ui/data';

/**
 * BUYER REQUESTS -- READ ONLY (B14, 2026-10-07). Administrator only.
 *
 * The owner: "purchase requests are accepted by the farmer, not CORWADO".
 * Buyer and farmer deal directly: the farmer accepts or declines on their own
 * dashboard, and the decision route refuses an administrator
 * (request_answered_by_farmer). This page lets CORWADO see what is being
 * asked for and how farmers answer -- nothing on it changes a request.
 * Orders and deliveries are no longer arranged by CORWADO, so their tab is gone.
 */
export function Procurement() {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--s-6)' }}>
      <PageHeader
        title="Buyer requests"
        subtitle="What buyers have asked farmers for, and how each farmer answered. Farmers accept or decline; this page only shows it."
      />
      <Requests />
    </div>
  );
}

function Requests() {
  const [status, setStatus] = useState<string>('submitted');
  const list = useCursorList((cursor) => adminListRequests(status || undefined, cursor), status);

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
                key: 'farmer',
                header: "Farmer's phone",
                nowrap: true,
                render: (r) => (r.farmer_phone ? formatPhone(r.farmer_phone) : '—'),
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
    </>
  );
}
