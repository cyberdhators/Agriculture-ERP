'use client';

import { useCallback, useEffect, useState } from 'react';

import type { ModerationAction, ProductReport } from '@agri-erp/shared';

import { ReasonCodeSelect } from '@/components/admin/ReasonCodeSelect';
import { ServiceNotConnectedError } from '@/lib/communications/api';
import { decideProductReport, listProductReports } from '@/lib/product-reports/api';
import { formatDate } from '@/lib/format';
import { usePreview } from '@/lib/preview';

import { Button, Dialog, Field, Notice, PageHeader, Stamp, Textarea } from '../ui';
import { DataTable, LoadingState, Pagination, UnavailableState } from '../ui/data';
import { ConfirmationDialog } from '../ui/feedback';
import { reasonLabel, statusLabel, statusTone } from './presentation';

/** The written reason a decision needs, as on the other report queue; the server keeps up to 500. */
const NOTE_MIN = 5;

/**
 * The decisions the server allows from each report status
 * (app/api/admin/product-reports/[id]/route.ts TRANSITIONS; it checks them
 * again). Resolved and dismissed are terminal, so they offer nothing.
 * `suspend_listing` is accepted by the server but only marks the report
 * reviewing -- it does nothing to the listing -- so it is not offered under a
 * name that would say otherwise.
 */
const ACTIONS: Record<string, ReadonlyArray<{ action: ModerationAction; label: string }>> = {
  new: [
    { action: 'mark_reviewing', label: 'Reviewing' },
    { action: 'resolve', label: 'Resolve' },
    { action: 'dismiss', label: 'Dismiss' },
    { action: 'remove_listing', label: 'Remove listing' },
  ],
  reviewing: [
    { action: 'resolve', label: 'Resolve' },
    { action: 'dismiss', label: 'Dismiss' },
    { action: 'remove_listing', label: 'Remove listing' },
  ],
};

const CONSEQUENCE: Record<string, string> = {
  mark_reviewing: 'The report is marked as being reviewed. The listing stays on the market.',
  resolve: 'The report is settled as resolved. The listing stays on the market.',
  dismiss: 'The report is settled as dismissed. The listing stays on the market.',
  remove_listing:
    "The listing leaves the market (it is not deleted) and the report is settled as resolved. The seller's account is not suspended: that is a separate decision on their record.",
};

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
 * DECISIONS (2026-10-26, CORWADO's acceptance test: "the server accepts
 * them but the screen has no buttons"). The report's detail offers the
 * decisions the server allows from its status -- mark reviewing, resolve,
 * dismiss, remove listing -- each through a dialog with a reason code from
 * Settings and a required written reason, as the buying-request and service
 * queue does (components/market-posts/MarketReports.tsx). The server enforces
 * the state machine and keeps the reason in the audit row. Removing a listing
 * is separate from the seller's account standing and from adviser approval.
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
  const [pending, setPending] = useState<{
    report: ProductReport;
    action: ModerationAction;
    label: string;
  } | null>(null);
  const [reasonCode, setReasonCode] = useState('');
  const [prefill, setPrefill] = useState('');
  const [note, setNote] = useState('');
  const [noteError, setNoteError] = useState<string | undefined>();
  const [deciding, setDeciding] = useState(false);
  const [decisionFailure, setDecisionFailure] = useState<string | null>(null);

  function openDecision(report: ProductReport, action: ModerationAction, label: string) {
    setDetail(null);
    setPending({ report, action, label });
    setReasonCode('');
    setPrefill('');
    setNote('');
    setNoteError(undefined);
    setDecisionFailure(null);
  }

  async function decide() {
    if (!pending) return;
    const written = note.trim();
    if (written.length < NOTE_MIN) {
      setNoteError(`Give a reason of at least ${NOTE_MIN} characters.`);
      return;
    }
    setDeciding(true);
    setDecisionFailure(null);
    try {
      await decideProductReport(pending.report.id, {
        action: pending.action,
        note: written,
        ...(reasonCode ? { reason_code: reasonCode } : {}),
      });
      setPending(null);
      setAttempt((n) => n + 1);
    } catch (e) {
      setDecisionFailure(e instanceof Error ? e.message : 'The decision was not recorded.');
    } finally {
      setDeciding(false);
    }
  }

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
            {(ACTIONS[detail.status] ?? []).length > 0 ? (
              <div
                style={{
                  display: 'flex',
                  flexWrap: 'wrap',
                  gap: 8,
                  marginBlockStart: 'var(--s-4)',
                }}
              >
                {(ACTIONS[detail.status] ?? []).map((a) => (
                  <Button
                    key={a.action}
                    size="small"
                    variant={a.action === 'remove_listing' ? 'danger' : 'secondary'}
                    onClick={() => openDecision(detail, a.action, a.label)}
                  >
                    {a.label}
                  </Button>
                ))}
              </div>
            ) : (
              <p className="small muted" style={{ marginBlockStart: 'var(--s-4)' }}>
                This report is settled. A settled report is not reopened.
              </p>
            )}
          </>
        ) : null}
      </Dialog>

      <ConfirmationDialog
        open={pending !== null}
        onCancel={() => setPending(null)}
        onConfirm={() => void decide()}
        title={pending ? `${pending.label}: record this decision?` : 'Record this decision?'}
        consequence={pending ? (CONSEQUENCE[pending.action] ?? '') : ''}
        confirmLabel={pending?.label ?? 'Confirm'}
        destructive={pending?.action === 'remove_listing'}
        busy={deciding}
      >
        {decisionFailure ? <Notice kind="error">{decisionFailure}</Notice> : null}
        <ReasonCodeSelect
          target={pending?.action === 'remove_listing' ? 'listing' : 'report'}
          value={reasonCode}
          onPick={(code, label) => {
            setReasonCode(code);
            const next = code ? `${label}: ` : '';
            // Replace only an empty reason or one this list wrote; never what was typed.
            if (note.trim() === '' || note === prefill) setNote(next);
            setPrefill(next);
          }}
        />
        <Field
          label="Reason"
          hint={`At least ${NOTE_MIN} characters, up to 500. Kept in the audit trail.`}
          error={noteError}
        >
          {(ids) => (
            <Textarea
              {...ids}
              rows={3}
              maxLength={500}
              value={note}
              onChange={(e) => setNote(e.target.value)}
            />
          )}
        </Field>
      </ConfirmationDialog>
    </div>
  );
}
