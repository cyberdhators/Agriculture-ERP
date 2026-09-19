'use client';

import { useCallback, useEffect, useState } from 'react';

import type { ProductReport } from '@agri-erp/shared';

import { ServiceNotConnectedError } from '@/lib/communications/api';
import { listProductReports } from '@/lib/product-reports/api';
import { formatDate } from '@/lib/format';
import { usePreview } from '@/lib/preview';

import { Button, Dialog, Notice, PageHeader, Stamp } from '../ui';
import { DataTable, LoadingState, Pagination, UnavailableState } from '../ui/data';
import { reasonLabel, statusLabel, statusTone } from './presentation';

/**
 * PRODUCT REPORTS — the administrator's marketplace moderation queue.
 *
 * NOT THE SAME THING AS "REPORTS". That is agricultural reporting and export,
 * deliverable (t). This is moderation of marketplace listings, and the two are
 * kept apart in name and in navigation so nobody has to guess.
 *
 * THE QUEUE IS SERVER-BACKED. `produce_listing`, `product_report` and the
 * administrator routes were built on 2026-09-17: the list, the detail and the
 * unread count all come from the database, cursor-paged.
 *
 * NOTHING HERE INVENTS A ROW. There are no fixtures and no browser storage: a
 * route that is not deployed raises `ServiceNotConnectedError` and the queue
 * says so. An empty queue and an absent service are different states and are
 * rendered differently, because "no listing has been reported" and "nobody has
 * looked" are opposite statements.
 *
 * THIS SCREEN READS; IT DOES NOT YET MODERATE. The server enforces the state
 * machine on `PATCH /api/admin/product-reports/:id` — mark reviewing, resolve,
 * dismiss, remove listing, with resolved and dismissed terminal — but no
 * button here calls it, because wiring those decisions is a change the owner
 * has not asked for. The screen offers nothing it cannot do rather than a
 * control whose consequences have not been agreed.
 */
export function ProductReports() {
  const { role, hydrated } = usePreview();
  const isAdmin = hydrated && role === 'admin';

  const [reports, setReports] = useState<ProductReport[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [back, setBack] = useState<Array<string | null>>([]);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [notConnected, setNotConnected] = useState<string | null>(null);
  const [error, setError] = useState<string | undefined>();
  const [detail, setDetail] = useState<ProductReport | null>(null);
  const [attempt, setAttempt] = useState(0);

  const load = useCallback(() => {
    if (!isAdmin) return;
    let live = true;
    setLoading(true);
    listProductReports({ ...(cursor ? { cursor } : {}) })
      .then((page) => {
        if (!live) return;
        setReports(page.reports);
        setNextCursor(page.cursor);
        setHasMore(page.hasMore);
        setNotConnected(null);
        setError(undefined);
      })
      .catch((err: unknown) => {
        if (!live) return;
        setReports([]);
        if (err instanceof ServiceNotConnectedError) setNotConnected(err.message);
        else setError('Could not load this information.');
      })
      .finally(() => live && setLoading(false));
    return () => {
      live = false;
    };
  }, [cursor, isAdmin]);

  useEffect(() => load(), [load, attempt]);

  if (!hydrated) return null;

  if (!isAdmin) {
    return (
      <div>
        <PageHeader eyebrow="Governance" title="Product reports" />
        <UnavailableState title="Product reports are not available to your role">
          Marketplace moderation is reserved to administrators.
        </UnavailableState>
      </div>
    );
  }

  return (
    <div>
      <PageHeader
        eyebrow="Governance"
        title="Product reports"
        subtitle="Listings that marketplace visitors have reported. Separate from Reports, which is agricultural reporting and export."
      />

      {loading ? (
        <LoadingState rows={5} label="Loading product reports" />
      ) : notConnected ? (
        <UnavailableState title="The marketplace report service is not connected">
          {notConnected} The queue could not be read because the route did not answer on this
          deployment. This is not an empty queue: nothing was counted, so nothing is shown. See{' '}
          <code>docs/api/product-reports-contract.md</code>.
        </UnavailableState>
      ) : error ? (
        <Notice kind="error" title="Could not load this information">
          <p className="small">
            The report queue could not be read just now.{' '}
            <Button variant="ghost" size="small" onClick={() => setAttempt((n) => n + 1)}>
              Try again
            </Button>
          </p>
        </Notice>
      ) : reports.length === 0 ? (
        <Notice kind="info" title="No product reports">
          <p className="small">
            No listing has been reported. This is a measured result from the report service, not an
            absence of information.
          </p>
        </Notice>
      ) : (
        <>
          <DataTable
            caption="Reported marketplace listings, newest first"
            rows={reports}
            rowKey={(r) => r.id}
            columns={[
              {
                key: 'listing',
                header: 'Listing',
                rowHeader: true,
                render: (r) => (
                  <>
                    {r.listing_title ?? <span className="muted">Listing unavailable</span>}
                    <span className="small muted mono" style={{ display: 'block' }}>
                      {r.listing_id}
                    </span>
                  </>
                ),
              },
              {
                key: 'vendor',
                header: 'Vendor',
                render: (r) => r.vendor_name ?? <span className="muted">Not shown</span>,
              },
              { key: 'reason', header: 'Reason', render: (r) => reasonLabel(r.reason) },
              {
                key: 'status',
                header: 'Status',
                nowrap: true,
                render: (r) => <Stamp kind={statusTone(r.status)}>{statusLabel(r.status)}</Stamp>,
              },
              {
                key: 'created',
                header: 'Reported',
                nowrap: true,
                render: (r) => formatDate(r.created_at),
              },
              {
                key: 'updated',
                header: 'Last updated',
                nowrap: true,
                render: (r) => formatDate(r.updated_at),
              },
              {
                key: 'open',
                header: 'Detail',
                printHidden: true,
                nowrap: true,
                render: (r) => (
                  <Button variant="secondary" size="small" onClick={() => setDetail(r)}>
                    Inspect
                  </Button>
                ),
              },
            ]}
          />
          <Pagination
            shown={reports.length}
            hasMore={hasMore}
            busy={loading}
            canGoBack={back.length > 0}
            onNext={() => {
              if (!nextCursor) return;
              setBack((past) => [...past, cursor]);
              setCursor(nextCursor);
            }}
            onPrevious={() =>
              setBack((past) => {
                if (past.length === 0) return past;
                setCursor(past[past.length - 1] ?? null);
                return past.slice(0, -1);
              })
            }
          />
        </>
      )}

      <Dialog
        open={detail !== null}
        onClose={() => setDetail(null)}
        title="Product report"
        footer={
          <Button variant="ghost" onClick={() => setDetail(null)}>
            Close
          </Button>
        }
      >
        {detail ? (
          <>
            <p className="label">Listing</p>
            <p>
              {detail.listing_title ?? 'Listing unavailable'}
              <span className="small muted mono" style={{ display: 'block' }}>
                {detail.listing_id}
              </span>
            </p>
            {detail.vendor_name ? <p className="small">Vendor: {detail.vendor_name}</p> : null}

            <p className="label" style={{ marginBlockStart: 'var(--s-4)' }}>
              Report
            </p>
            <p className="small">
              {reasonLabel(detail.reason)} · {statusLabel(detail.status)} · reported{' '}
              {formatDate(detail.created_at)}
            </p>
            {detail.description ? <p className="small">{detail.description}</p> : null}

            {/*
             * No reporter identity is shown. A marketplace visitor holds no
             * account, so storing or displaying anything identifying would make
             * the REPORTER personal data as well as the listing. Whether
             * anything is stored at all is still an open question in the
             * position paper, and the contract carries nothing until it is
             * answered — the direction that can be widened later without a
             * privacy incident.
             */}
            <p className="small muted" style={{ marginBlockStart: 'var(--s-4)' }}>
              Moderation actions are not available: each needs a state transition and its own
              authorization on the server, and none exists yet.
            </p>
          </>
        ) : null}
      </Dialog>
    </div>
  );
}
