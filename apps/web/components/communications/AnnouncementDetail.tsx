'use client';

import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';

import {
  ANNOUNCEMENT_CHANNELS,
  ANNOUNCEMENT_SCOPE_LABELS,
  DELIVERY_SKIP_LABELS,
  DELIVERY_STATUSES,
  type AnnouncementChannel,
  type AnnouncementDelivery,
  type AnnouncementPreview,
  type DeliveryStatus,
  type StaffAnnouncement,
} from '@agri-erp/shared';

import {
  Badge,
  Button,
  Card,
  CardBody,
  CardHeader,
  Notice,
  PageHeader,
  Select,
} from '@/components/ui';
import { ConfirmationDialog } from '@/components/ui/feedback';
import { DataTable, Pagination } from '@/components/ui/data';
import { formatDate } from '@/lib/format';
import {
  asFailure,
  discardAnnouncement,
  getAnnouncement,
  listDeliveries,
  previewAnnouncement,
  processAnnouncement,
  retryAnnouncement,
  sendAnnouncement,
  type AnnouncementState,
  type Failure,
} from '@/lib/communications/announcements';
import { useLocationNames } from '@/lib/portal/locations';
import { usePreview } from '@/lib/preview';

import { ACTIVITY_LABELS, AnnouncementComposer, CHANNEL_LABELS } from './AnnouncementComposer';
import { PageLoading } from '@/components/ui/data';

const STATUS_LABELS: Record<DeliveryStatus, string> = {
  queued: 'Waiting',
  sending: 'Sending',
  sent: 'Sent',
  failed: 'Failed',
  skipped: 'Not sent',
};

const ANNOUNCEMENT_STATUS: Record<StaffAnnouncement['status'], string> = {
  draft: 'Draft',
  sending: 'Sending',
  completed: 'Completed',
};

/**
 * ONE ANNOUNCEMENT (2026-10-27): its text, a preview before sending, the send
 * itself (after a confirmation), the batches that deliver it, and the
 * delivery record -- one row per recipient per channel with its status,
 * reason, provider message id and error.
 *
 * Sending runs in batches from this page, and -- since 2026-10-29 -- also
 * every two minutes from a scheduled job (POST /api/cron/announcements), so
 * closing the page no longer stops it; "Continue sending" just goes faster,
 * and Pause stops only this page's batches. Failed deliveries are retried
 * only when someone presses "Retry failed".
 */
export function AnnouncementDetail({ id }: { id: string }) {
  const { role, hydrated } = usePreview();
  // 2026-10-30: any staff role; the route decides by permission (a 403 shows the refusal).
  const isAdmin = hydrated && role !== 'officer';
  const [state, setState] = useState<AnnouncementState | null>(null);
  const [failure, setFailure] = useState<Failure | null>(null);
  const [editing, setEditing] = useState(false);
  const [preview, setPreview] = useState<AnnouncementPreview | null>(null);
  const [previewBusy, setPreviewBusy] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [discarding, setDiscarding] = useState(false);
  const [running, setRunning] = useState(false);
  const [waiting, setWaiting] = useState<AnnouncementChannel[]>([]);
  const [deliveriesKey, setDeliveriesKey] = useState(0);
  const stop = useRef(false);
  const locations = useLocationNames(true);

  const load = useCallback(async () => {
    try {
      setState(await getAnnouncement(id));
      setFailure(null);
    } catch (e) {
      setFailure(asFailure(e));
    }
  }, [id]);

  useEffect(() => {
    if (isAdmin) void load();
    return () => {
      stop.current = true;
    };
  }, [isAdmin, load]);

  const runBatches = useCallback(async () => {
    setRunning(true);
    stop.current = false;
    try {
      for (let i = 0; i < 500 && !stop.current; i += 1) {
        const fresh = await processAnnouncement(id);
        setState(fresh);
        const b = fresh.batch;
        const progressed =
          !!b &&
          b.in_app_sent +
            b.sms.sent +
            b.sms.failed +
            b.sms.skipped +
            b.email.sent +
            b.email.failed +
            b.email.skipped >
            0;
        setWaiting(b?.waiting_for_configuration ?? []);
        if (fresh.remaining === 0 || fresh.announcement.status !== 'sending') break;
        if (!progressed) break;
      }
    } catch (e) {
      setFailure(asFailure(e));
    } finally {
      setRunning(false);
      setDeliveriesKey((k) => k + 1);
    }
  }, [id]);

  const loadPreview = async () => {
    setPreviewBusy(true);
    setFailure(null);
    try {
      setPreview(await previewAnnouncement(id));
    } catch (e) {
      setFailure(asFailure(e));
    } finally {
      setPreviewBusy(false);
    }
  };

  const confirmSend = async () => {
    if (!preview) return;
    setConfirming(false);
    setFailure(null);
    try {
      setState(await sendAnnouncement(id, preview.recipients));
      setPreview(null);
      await runBatches();
    } catch (e) {
      const f = asFailure(e);
      setFailure(f);
      // The recipients changed: show the fresh preview.
      if (f.status === 409) void loadPreview();
    }
  };

  const discard = async () => {
    setDiscarding(false);
    try {
      await discardAnnouncement(id);
      window.location.assign('/communications');
    } catch (e) {
      setFailure(asFailure(e));
    }
  };

  const retry = async () => {
    try {
      setState(await retryAnnouncement(id));
      await runBatches();
    } catch (e) {
      setFailure(asFailure(e));
    }
  };

  if (!isAdmin || failure?.status === 403) {
    return (
      <Notice kind="info" title="Administrators only">
        <p className="small">
          Announcements are sent by administrators who hold Send official announcements.
        </p>
      </Notice>
    );
  }
  if (!state) {
    return failure ? (
      <Notice kind="error" title="This announcement could not be loaded">
        <p className="small">{failure.message}</p>
      </Notice>
    ) : (
      <PageLoading />
    );
  }

  const a = state.announcement;
  const scope =
    a.scope.kind === 'state'
      ? `${ANNOUNCEMENT_SCOPE_LABELS.state}: ${locations.state(a.scope.state_id ?? '') ?? a.scope.state_id}`
      : a.scope.kind === 'activity' && a.scope.activity
        ? `${ANNOUNCEMENT_SCOPE_LABELS.activity}: ${ACTIVITY_LABELS[a.scope.activity]}`
        : ANNOUNCEMENT_SCOPE_LABELS[a.scope.kind];
  const failed = ANNOUNCEMENT_CHANNELS.reduce((n, c) => n + state.deliveries[c].failed, 0);

  return (
    <section style={{ display: 'grid', gap: 'var(--s-4)' }}>
      <p className="small">
        <Link href="/communications">← Communications</Link>
      </p>
      <PageHeader
        title={a.title}
        subtitle={`${ANNOUNCEMENT_STATUS[a.status]} · ${scope} · ${a.channels.map((c) => CHANNEL_LABELS[c]).join(', ')}${a.category === 'essential' ? ' · Essential' : ''}`}
      />
      {failure ? (
        <Notice kind="error">
          <p className="small">{failure.message}</p>
        </Notice>
      ) : null}

      {editing ? (
        <AnnouncementComposer
          announcement={a}
          onCancel={() => setEditing(false)}
          onSaved={() => {
            setEditing(false);
            setPreview(null);
            void load();
          }}
        />
      ) : (
        <Card>
          <CardHeader
            title="Message"
            subtitle={`Created ${formatDate(a.created_at)}${a.created_by ? ` by ${a.created_by}` : ''}${a.sent_at ? ` · sent ${formatDate(a.sent_at)}${a.sent_by ? ` by ${a.sent_by}` : ''}` : ''}`}
            actions={
              a.status === 'draft' ? (
                <>
                  <Button size="small" variant="secondary" onClick={() => setEditing(true)}>
                    Edit
                  </Button>
                  <Button size="small" variant="ghost" onClick={() => setDiscarding(true)}>
                    Discard
                  </Button>
                </>
              ) : undefined
            }
          />
          <CardBody>
            <p className="small" dir="auto" style={{ whiteSpace: 'pre-wrap' }}>
              {a.body}
            </p>
            {a.sms_body ? (
              <p className="small" dir="auto">
                <strong>SMS:</strong> {a.sms_body}
              </p>
            ) : null}
          </CardBody>
        </Card>
      )}

      {a.status === 'draft' && !editing ? (
        <Card>
          <CardHeader
            title="Preview before sending"
            subtitle="The text as a recipient sees it, who receives it on each channel, and what SMS will cost. Each person's notification settings are applied."
          />
          <CardBody>
            <div>
              <Button onClick={() => void loadPreview()} disabled={previewBusy}>
                {previewBusy ? 'Preparing preview…' : preview ? 'Refresh preview' : 'Preview'}
              </Button>
            </div>
            {preview ? <PreviewView preview={preview} /> : null}
            {preview ? (
              <div>
                <Button
                  onClick={() => setConfirming(true)}
                  disabled={
                    ANNOUNCEMENT_CHANNELS.reduce((n, c) => n + preview.channels[c].will_send, 0) ===
                    0
                  }
                >
                  Send…
                </Button>
              </div>
            ) : null}
          </CardBody>
        </Card>
      ) : null}

      {a.status !== 'draft' ? (
        <Card>
          <CardHeader
            title="Delivery"
            subtitle={
              a.status === 'completed'
                ? `Completed ${a.completed_at ? formatDate(a.completed_at) : ''}. ${a.recipient_count ?? 0} recipients.`
                : `${state.remaining} deliveries waiting. ${a.recipient_count ?? 0} recipients. Sending continues every few minutes even when this page is closed.`
            }
            actions={
              <>
                {a.status === 'sending' ? (
                  <Button size="small" onClick={() => void runBatches()} disabled={running}>
                    {running ? 'Sending…' : 'Continue sending'}
                  </Button>
                ) : null}
                {running ? (
                  <Button size="small" variant="ghost" onClick={() => (stop.current = true)}>
                    Pause
                  </Button>
                ) : null}
                {failed > 0 && !running ? (
                  <Button size="small" variant="secondary" onClick={() => void retry()}>
                    Retry {failed} failed
                  </Button>
                ) : null}
              </>
            }
          />
          <CardBody>
            {waiting.length > 0 ? (
              <Notice kind="warn" title="Waiting for the service to be configured">
                <p className="small">
                  {waiting.map((c) => CHANNEL_LABELS[c]).join(' and ')} cannot be sent from this
                  deployment yet (the provider is not configured, or the database update for
                  announcements has not been applied). Those deliveries stay waiting; nothing was
                  reported as sent.
                </p>
              </Notice>
            ) : null}
            <CountsTable state={state} />
          </CardBody>
        </Card>
      ) : null}

      {a.status !== 'draft' ? <DeliveryRecord id={id} refresh={deliveriesKey} /> : null}

      <ConfirmationDialog
        open={confirming}
        onCancel={() => setConfirming(false)}
        onConfirm={() => void confirmSend()}
        title="Send this announcement?"
        confirmLabel="Send now"
        consequence={
          preview ? (
            <>
              <p>
                It goes to {preview.recipients}{' '}
                {preview.recipients === 1 ? 'recipient' : 'recipients'}:{' '}
                {ANNOUNCEMENT_CHANNELS.filter((c) => preview.channels[c].selected)
                  .map((c) => `${preview.channels[c].will_send} ${CHANNEL_LABELS[c].toLowerCase()}`)
                  .join(', ')}
                .
              </p>
              {preview.sms ? <p>{smsCostSentence(preview.sms)}</p> : null}
              <p>A sent announcement cannot be edited or recalled.</p>
            </>
          ) : null
        }
      />
      <ConfirmationDialog
        open={discarding}
        onCancel={() => setDiscarding(false)}
        onConfirm={() => void discard()}
        title="Discard this draft?"
        confirmLabel="Discard draft"
        destructive
        consequence={<p>The draft is removed from the list. Nothing was sent.</p>}
      />
    </section>
  );
}

function smsCostSentence(sms: NonNullable<AnnouncementPreview['sms']>): string {
  const parts = `${sms.total_segments} SMS part${sms.total_segments === 1 ? '' : 's'} (${sms.segments_per_message} per message)`;
  return sms.estimated_cost_usd === null
    ? `${parts} will be billed by the SMS provider. No cost per part is set in Settings, so no estimate is shown.`
    : `${parts}: about US$${sms.estimated_cost_usd.toFixed(2)} at US$${sms.cost_per_segment_usd} a part.`;
}

function PreviewView({ preview }: { preview: AnnouncementPreview }) {
  return (
    <div style={{ display: 'grid', gap: 12, marginTop: 12 }}>
      <p>
        <strong>{preview.recipients}</strong> {preview.recipients === 1 ? 'account' : 'accounts'} in
        scope.
      </p>
      <div style={{ border: '1px solid var(--line)', borderRadius: 8, padding: 12 }}>
        <p className="small muted">As received (with the example name Amina):</p>
        <p dir="auto">
          <strong>{preview.rendered.title}</strong>
        </p>
        <p className="small" dir="auto" style={{ whiteSpace: 'pre-wrap' }}>
          {preview.rendered.body}
        </p>
        {preview.rendered.sms_body ? (
          <p className="small" dir="auto">
            <strong>SMS:</strong> {preview.rendered.sms_body}
          </p>
        ) : null}
      </div>
      <DataTable
        caption="Who receives it, per channel"
        columns={[
          {
            key: 'channel',
            header: 'Channel',
            rowHeader: true,
            render: (c: AnnouncementChannel) => CHANNEL_LABELS[c],
          },
          {
            key: 'send',
            header: 'Will be sent',
            numeric: true,
            render: (c) => preview.channels[c].will_send,
          },
          {
            key: 'pref',
            header: 'Switched off',
            numeric: true,
            render: (c) => preview.channels[c].skipped_preference,
          },
          {
            key: 'none',
            header: 'No address or inbox',
            numeric: true,
            render: (c) => preview.channels[c].skipped_no_contact,
          },
          {
            key: 'dup',
            header: 'Shared phone or inbox',
            numeric: true,
            render: (c) => preview.channels[c].skipped_duplicate,
          },
        ]}
        rows={ANNOUNCEMENT_CHANNELS.filter((c) => preview.channels[c].selected)}
        rowKey={(c) => c}
      />
      {preview.sms ? (
        <Notice kind="info" title="SMS cost">
          <p className="small">{smsCostSentence(preview.sms)}</p>
          {preview.sms.encoding === 'ucs2' ? (
            <p className="small">
              The text uses Arabic or special characters, so each part holds fewer characters.
            </p>
          ) : null}
        </Notice>
      ) : null}
    </div>
  );
}

function CountsTable({ state }: { state: AnnouncementState }) {
  const channels = state.announcement.channels;
  const receipts = channels.includes('sms') ? state.sms_receipts : undefined;
  return (
    <>
      <DataTable
        caption="Deliveries by channel and status"
        columns={[
          {
            key: 'channel',
            header: 'Channel',
            rowHeader: true,
            render: (c: AnnouncementChannel) => CHANNEL_LABELS[c],
          },
          ...DELIVERY_STATUSES.map((s) => ({
            key: s,
            header: STATUS_LABELS[s],
            numeric: true,
            render: (c: AnnouncementChannel) => state.deliveries[c][s],
          })),
        ]}
        rows={channels}
        rowKey={(c) => c}
      />
      {receipts ? (
        // 2026-10-26: "Sent" means Bird accepted the SMS; "delivered to phone"
        // is the carrier's own report, from Bird's delivery webhook.
        <p className="small" style={{ marginTop: 'var(--s-2)' }}>
          SMS: <strong>{receipts.sent}</strong> sent · <strong>{receipts.delivered}</strong>{' '}
          delivered to phone · <strong>{receipts.not_delivered}</strong> not delivered ·{' '}
          <span className="muted">{receipts.awaiting} awaiting a carrier report</span>
        </p>
      ) : null}
    </>
  );
}

function DeliveryRecord({ id, refresh }: { id: string; refresh: number }) {
  const [channel, setChannel] = useState('');
  const [status, setStatus] = useState('');
  const [rows, setRows] = useState<AnnouncementDelivery[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [next, setNext] = useState<string | null>(null);
  const [back, setBack] = useState<(string | null)[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    listDeliveries(id, { channel, status, cursor })
      .then((p) => {
        if (!live) return;
        setRows(p.rows);
        setNext(p.page.cursor);
        setHasMore(p.page.hasMore);
        setError(null);
      })
      .catch((e) => {
        if (live) setError(asFailure(e).message);
      });
    return () => {
      live = false;
    };
  }, [id, channel, status, cursor, refresh]);

  return (
    <Card>
      <CardHeader
        title="Delivery record"
        subtitle="One row per recipient per channel. Phone numbers and addresses are not stored here."
      />
      <CardBody>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <Select
            aria-label="Channel"
            value={channel}
            onChange={(e) => {
              setChannel(e.target.value);
              setCursor(null);
              setBack([]);
            }}
          >
            <option value="">All channels</option>
            {ANNOUNCEMENT_CHANNELS.map((c) => (
              <option key={c} value={c}>
                {CHANNEL_LABELS[c]}
              </option>
            ))}
          </Select>
          <Select
            aria-label="Status"
            value={status}
            onChange={(e) => {
              setStatus(e.target.value);
              setCursor(null);
              setBack([]);
            }}
          >
            <option value="">All statuses</option>
            {DELIVERY_STATUSES.map((s) => (
              <option key={s} value={s}>
                {STATUS_LABELS[s]}
              </option>
            ))}
          </Select>
        </div>
        {error ? <p className="small error">{error}</p> : null}
        <DataTable
          caption="Delivery record"
          columns={[
            {
              key: 'who',
              header: 'Recipient',
              rowHeader: true,
              render: (r: AnnouncementDelivery) => r.recipient_name ?? '—',
            },
            { key: 'kind', header: 'Kind', render: (r) => r.recipient_kind },
            { key: 'channel', header: 'Channel', render: (r) => CHANNEL_LABELS[r.channel] },
            {
              key: 'status',
              header: 'Status',
              render: (r) => (
                <Badge
                  tone={r.status === 'sent' ? 'leaf' : r.status === 'failed' ? 'clay' : 'neutral'}
                >
                  {STATUS_LABELS[r.status]}
                </Badge>
              ),
            },
            {
              key: 'detail',
              header: 'Detail',
              render: (r) =>
                r.skip_reason
                  ? DELIVERY_SKIP_LABELS[r.skip_reason]
                  : r.error
                    ? r.error
                    : r.provider_message_id
                      ? `Provider id ${r.provider_message_id}`
                      : '',
            },
            {
              key: 'when',
              header: 'Sent',
              render: (r) => (r.sent_at ? formatDate(r.sent_at) : ''),
            },
          ]}
          rows={rows}
          rowKey={(r) => r.id}
          empty={<p className="small muted">No deliveries match.</p>}
        />
        <Pagination
          shown={rows.length}
          hasMore={hasMore}
          canGoBack={back.length > 0}
          onNext={() => {
            setBack([...back, cursor]);
            setCursor(next);
          }}
          onPrevious={() => {
            setCursor(back[back.length - 1] ?? null);
            setBack(back.slice(0, -1));
          }}
        />
      </CardBody>
    </Card>
  );
}
