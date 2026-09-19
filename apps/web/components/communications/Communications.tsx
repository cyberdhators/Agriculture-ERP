'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';

import {
  CHANNEL_RECIPIENTS,
  COMMUNICATION_LIMITS,
  sendCommunicationSchema,
  type CommunicationChannel,
  type CommunicationResult,
  type RecipientType,
} from '@agri-erp/shared';

import { LIVE_ADMIN, listOfficers, listStaff, type Officer, type StaffUser } from '@/lib/admin/api';
import { ROLE_LABELS } from '@/lib/admin/account-rules';
import { ServiceNotConnectedError, sendCommunication } from '@/lib/communications/api';
import { usePreview } from '@/lib/preview';

import { Button, Checkbox, Dialog, Field, Input, Notice, PageHeader, Textarea } from '../ui';
import { LoadingState, Pagination, UnavailableState } from '../ui/data';
import styles from './comms.module.css';

/**
 * ADMINISTRATOR COMMUNICATIONS.
 *
 * EMAIL SENDS FOR REAL, THROUGH RESEND. `POST /api/admin/communications` was
 * built on 2026-09-17 and this screen calls it. Three outcomes are possible
 * and each is reported as itself: a send, a 503 `email_not_configured` when
 * the deployment has no key or sender, and a 503 `email_unavailable` when the
 * provider cannot be reached. Nothing here mocks a response, and there is no
 * code path that can report a delivery that did not happen. SMS remains
 * unbuilt and says so on its own tab.
 *
 * WHY EMAIL LISTS ONLY STAFF. Neither the farmer nor the officer table has an
 * email column. An officer's `officer.<digits>@officers.invalid` identifier is
 * not an address — `.invalid` exists precisely so that nothing can be
 * delivered to it — and it is never displayed or treated as one. SMS is the
 * contracted channel for a farmer, deliverable (n). `CHANNEL_RECIPIENTS` in
 * the shared contract is the single place that decision lives, so the day a
 * column is added the screen follows without being rewritten.
 *
 * ADDRESSES NEVER REACH THE BROWSER. The picker shows a name, a role and a
 * scope; the send carries RECORD IDS. The server resolves each id to a contact
 * itself — which is also why the users route does not return email addresses,
 * and why this screen does not ask it to.
 */

const CHANNEL_LABEL: Record<CommunicationChannel, string> = { email: 'Email', sms: 'SMS' };

const RECIPIENT_LABEL: Record<RecipientType, string> = {
  staff: 'Staff accounts',
  officer: 'Extension officers',
  farmer: 'Farmers',
};

interface Candidate {
  id: string;
  name: string;
  meta: string;
}

export function Communications() {
  const { role, hydrated } = usePreview();
  const isAdmin = hydrated && role === 'admin';

  const [channel, setChannel] = useState<CommunicationChannel>('email');
  const [recipientType, setRecipientType] = useState<RecipientType>('staff');
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [confirming, setConfirming] = useState(false);
  const [sending, setSending] = useState(false);
  const [result, setResult] = useState<CommunicationResult | null>(null);
  const [notConnected, setNotConnected] = useState<string | null>(null);
  const [sendError, setSendError] = useState<string | undefined>();

  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [back, setBack] = useState<Array<string | null>>([]);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(false);
  const [listError, setListError] = useState<string | undefined>();

  const allowed = CHANNEL_RECIPIENTS[channel];

  // Changing channel changes who can be addressed, so the selection cannot
  // survive it: a staff id means nothing on an SMS send.
  useEffect(() => {
    const first = CHANNEL_RECIPIENTS[channel][0];
    if (first && !CHANNEL_RECIPIENTS[channel].includes(recipientType)) setRecipientType(first);
  }, [channel, recipientType]);

  useEffect(() => {
    setSelected(new Set());
    setCursor(null);
    setBack([]);
  }, [recipientType, channel]);

  /**
   * The picker is SERVER-PAGED against the routes that already exist. Nobody
   * downloads the register to populate a dropdown.
   */
  useEffect(() => {
    if (!isAdmin || !LIVE_ADMIN) return;
    let live = true;
    setLoading(true);
    const page = { cursor: cursor ?? undefined, limit: 25 };
    const source =
      recipientType === 'staff'
        ? listStaff(page).then((p) => ({
            rows: p.rows.map((u: StaffUser): Candidate => ({
              id: u.id,
              name: u.name,
              meta: ROLE_LABELS[u.role] ?? u.role,
            })),
            cursor: p.cursor,
            hasMore: p.hasMore,
          }))
        : recipientType === 'officer'
          ? listOfficers(page).then((p) => ({
              rows: p.rows.map((o: Officer): Candidate => ({
                id: o.id,
                name: o.name,
                meta: o.status === 'active' ? 'Active' : 'Inactive',
              })),
              cursor: p.cursor,
              hasMore: p.hasMore,
            }))
          : Promise.reject(new ServiceNotConnectedError('A farmer recipient list'));

    source
      .then((p) => {
        if (!live) return;
        setCandidates(p.rows);
        setNextCursor(p.cursor);
        setHasMore(p.hasMore);
        setListError(undefined);
      })
      .catch((err: unknown) => {
        if (!live) return;
        setCandidates([]);
        setListError(
          err instanceof ServiceNotConnectedError
            ? err.message
            : 'Could not load this information.',
        );
      })
      .finally(() => live && setLoading(false));
    return () => {
      live = false;
    };
  }, [recipientType, cursor, isAdmin]);

  const valid = useMemo(
    () =>
      sendCommunicationSchema.safeParse({
        channel,
        recipient_type: recipientType,
        recipient_ids: [...selected],
        ...(channel === 'email' ? { subject } : {}),
        body,
      }),
    [channel, recipientType, selected, subject, body],
  );

  const send = useCallback(async () => {
    setSending(true);
    setSendError(undefined);
    setNotConnected(null);
    try {
      const sent = await sendCommunication({
        channel,
        recipient_type: recipientType,
        recipient_ids: [...selected],
        ...(channel === 'email' ? { subject: subject.trim() } : {}),
        body: body.trim(),
      });
      setResult(sent);
      setConfirming(false);
      setSubject('');
      setBody('');
      setSelected(new Set());
    } catch (err) {
      // The composed message is deliberately NOT cleared on failure: an
      // administrator who has just written five hundred words should not lose
      // them because a provider was unreachable.
      setConfirming(false);
      if (err instanceof ServiceNotConnectedError) setNotConnected(err.message);
      else setSendError(err instanceof Error ? err.message : 'The message could not be sent.');
    } finally {
      setSending(false);
    }
  }, [channel, recipientType, selected, subject, body]);

  if (!hydrated) return null;

  if (!isAdmin) {
    return (
      <div className={styles.stack}>
        <PageHeader eyebrow="Communications" title="Communications" />
        <UnavailableState title="Communications is not available to your role">
          Sending messages from the portal is reserved to administrators.
        </UnavailableState>
      </div>
    );
  }

  return (
    <div className={styles.stack}>
      <PageHeader
        eyebrow="Communications"
        title="Communications"
        subtitle="Write to staff, officers and farmers from the portal. Recipients are addressed by record, and the server resolves each contact — no address or phone number reaches this screen."
      />

      {/*
        NO PERMANENT BANNER. `POST /api/admin/communications` exists and sends
        through Resend. Whether the PROVIDER is configured on this particular
        deployment is not something this screen can know in advance -- the
        route answers 503 `email_not_configured` when the key or the sender is
        missing -- so it is reported when it happens, in the words the server
        used, rather than announced in advance as a fact about every
        deployment. A standing warning that contradicted a working send would
        be the worse of the two errors.
      */}
      <div className={styles.channels} role="tablist" aria-label="Channel">
        {(['email', 'sms'] as const).map((key) => (
          <button
            key={key}
            type="button"
            role="tab"
            aria-selected={channel === key}
            className={`${styles.channel} ${channel === key ? styles.channelActive : ''}`}
            onClick={() => setChannel(key)}
          >
            {CHANNEL_LABEL[key]}
          </button>
        ))}
      </div>

      {channel === 'sms' ? (
        <UnavailableState title="SMS is not implemented">
          Bird is the decided provider and its settings are present in <code>.env.example</code>,
          but no SMS library or send route exists. SMS is billed per message and per segment, so a
          send will not be offered until the cost of one can be shown before it is made.
        </UnavailableState>
      ) : null}

      <div className={styles.panel}>
        <Field
          label="Recipient type"
          hint={
            channel === 'email'
              ? 'Only staff accounts hold an email address. Farmers and extension officers have phone numbers; their tables have no email column, and an officer’s sign-in identifier is not an address.'
              : 'Farmers and extension officers are reached by phone.'
          }
        >
          {(ids) => (
            <div {...ids} className={styles.channels} style={{ border: 0 }}>
              {allowed.map((type) => (
                <button
                  key={type}
                  type="button"
                  className={`${styles.channel} ${recipientType === type ? styles.channelActive : ''}`}
                  onClick={() => setRecipientType(type)}
                >
                  {RECIPIENT_LABEL[type]}
                </button>
              ))}
            </div>
          )}
        </Field>

        {selected.size > 0 ? (
          <div className={styles.selectedBar}>
            <span>
              <strong>{selected.size}</strong> {selected.size === 1 ? 'recipient' : 'recipients'}{' '}
              selected on this page
            </span>
            <Button variant="ghost" size="small" onClick={() => setSelected(new Set())}>
              Clear selection
            </Button>
          </div>
        ) : null}

        {!LIVE_ADMIN ? (
          <UnavailableState title="No live directory of recipients">
            Recipient lists are read from the live staff and officer routes. This deployment is
            running on preview data, so no real person can be selected.
          </UnavailableState>
        ) : listError ? (
          <UnavailableState title="Recipients unavailable">{listError}</UnavailableState>
        ) : loading ? (
          <LoadingState rows={4} label="Loading recipients" />
        ) : candidates.length === 0 ? (
          <Notice kind="info" title="No recipients">
            <p className="small">No {RECIPIENT_LABEL[recipientType].toLowerCase()} to show.</p>
          </Notice>
        ) : (
          <>
            <div className={styles.picker}>
              {candidates.map((c) => (
                <div key={c.id} className={styles.pickerRow}>
                  <Checkbox
                    label={`Select ${c.name}`}
                    labelHidden
                    checked={selected.has(c.id)}
                    onChange={() =>
                      setSelected((was) => {
                        const next = new Set(was);
                        if (next.has(c.id)) next.delete(c.id);
                        else next.add(c.id);
                        return next;
                      })
                    }
                  />
                  <span className={styles.pickerName} dir="auto">
                    {c.name}
                  </span>
                  <span className={styles.pickerMeta}>{c.meta}</span>
                </div>
              ))}
            </div>
            <Pagination
              shown={candidates.length}
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
      </div>

      <div className={styles.panel}>
        {channel === 'email' ? (
          <Field
            label="Subject"
            error={undefined}
            hint={`${subject.length} / ${COMMUNICATION_LIMITS.subjectMax} characters`}
          >
            {(ids) => (
              <Input
                {...ids}
                value={subject}
                maxLength={COMMUNICATION_LIMITS.subjectMax}
                onChange={(e) => setSubject(e.target.value)}
              />
            )}
          </Field>
        ) : null}

        <Field label="Message" hint={`${body.length} / ${COMMUNICATION_LIMITS.bodyMax} characters`}>
          {(ids) => (
            <Textarea
              {...ids}
              value={body}
              maxLength={COMMUNICATION_LIMITS.bodyMax}
              onChange={(e) => setBody(e.target.value)}
            />
          )}
        </Field>

        {!valid.success && (selected.size > 0 || body) ? (
          <p className={styles.counter}>
            {valid.error.issues[0]?.message ?? 'The message is not ready to send.'}
          </p>
        ) : null}

        <div style={{ marginBlockStart: 'var(--s-4)' }}>
          <Button disabled={!valid.success || sending} onClick={() => setConfirming(true)}>
            Review and send
          </Button>
        </div>
      </div>

      {notConnected ? (
        <Notice kind="error" title="Not sent — the messaging service is not connected">
          <p className="small">
            {notConnected} Your message has been kept above. Nothing was delivered and nothing was
            recorded.
          </p>
        </Notice>
      ) : null}

      {sendError ? (
        <Notice kind="error" title="Not sent">
          <p className="small">{sendError} Your message has been kept above.</p>
        </Notice>
      ) : null}

      {result ? (
        <Notice kind="success" title="Accepted by the provider">
          <p className="small">
            {result.accepted} of {result.requested} accepted · {result.unreachable} had no contact
            on file · {result.failed} refused. Acceptance is not delivery; the provider reports
            delivery separately.
          </p>
        </Notice>
      ) : null}

      <Dialog
        open={confirming}
        onClose={() => setConfirming(false)}
        title="Send message?"
        footer={
          <>
            <Button variant="ghost" onClick={() => setConfirming(false)} disabled={sending}>
              Cancel
            </Button>
            <Button onClick={() => void send()} disabled={sending}>
              {sending ? 'Sending…' : `Send ${CHANNEL_LABEL[channel].toLowerCase()}`}
            </Button>
          </>
        }
      >
        <dl className={styles.facts}>
          <dt>Channel</dt>
          <dd>{CHANNEL_LABEL[channel]}</dd>
          <dt>Recipients</dt>
          <dd>
            {selected.size} {RECIPIENT_LABEL[recipientType].toLowerCase()}
          </dd>
          {channel === 'email' ? (
            <>
              <dt>Subject</dt>
              <dd>{subject}</dd>
            </>
          ) : null}
        </dl>
        <p className="label">Message</p>
        <div className={styles.previewBody}>{body}</div>
        <p className="small muted" style={{ marginBlockStart: 'var(--s-3)' }}>
          The server resolves each recipient&apos;s contact details; any recipient with none on file
          is reported back rather than silently skipped.
        </p>
      </Dialog>
    </div>
  );
}
