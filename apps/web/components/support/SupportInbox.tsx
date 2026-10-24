'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';

import type { SupportAccountLink, SupportMessage, SupportStatus } from '@agri-erp/shared';

import { Button, Notice, Stamp } from '@/components/ui';
import { formatDate } from '@/lib/format';
import { usePreview } from '@/lib/preview';

const TOPIC_LABEL: Record<SupportMessage['topic'], string> = {
  account: 'Account',
  marketplace: 'Marketplace',
  messages: 'Messages',
  technical: 'Technical',
  appeal: 'Appeal',
  other: 'Other',
};

const FROM_LABEL: Record<SupportMessage['from_kind'], string> = {
  farmer: 'Farmer (signed in)',
  buyer: 'Buyer (signed in)',
  visitor: 'Visitor',
};

/**
 * "Contact CORWADO" messages (2026-10-21), newest first. Administrator only
 * (the routes refuse anyone else, and then ask for support.handle). Staff
 * read, contact the person outside the app, and mark it done. No replies,
 * assignment or tickets: the owner's choice.
 *
 * 2026-10-26 (CORWADO's acceptance test, "review appeal and restore"): an
 * Appeals view, and on an appeal whose account can be told, a link to the
 * farmer's record or the buyer's row, where Restore is. Still a message: the
 * decision is made on the record, then the message is marked done.
 */

/** Where an appeal's account is: the farmer's record, or the Buyer accounts tab its organisation is on. */
function accountHref(account: SupportAccountLink): string {
  if (account.kind === 'farmer') return `/farmers/${account.id}`;
  return account.buyer_standing
    ? `/admin/buyers?standing=${encodeURIComponent(account.buyer_standing)}`
    : '/admin/buyers';
}
export function SupportInbox() {
  const { role, hydrated } = usePreview();
  const isAdmin = hydrated && role === 'admin';
  const [status, setStatus] = useState<SupportStatus>('new');
  const [appealsOnly, setAppealsOnly] = useState(false);
  const [rows, setRows] = useState<SupportMessage[] | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(() => {
    setRows(null);
    fetch(`/api/admin/support?status=${status}${appealsOnly ? '&topic=appeal' : ''}&limit=100`)
      .then(async (res) => {
        const body = (await res.json().catch(() => ({}))) as {
          data?: SupportMessage[];
          error?: { message: string };
        };
        if (!res.ok)
          throw new Error(body.error?.message ?? `The messages could not be read (${res.status}).`);
        setRows(body.data ?? []);
        setFailure(null);
      })
      .catch((e: unknown) => {
        setRows([]);
        setFailure(e instanceof Error ? e.message : String(e));
      });
  }, [status, appealsOnly]);

  useEffect(() => {
    if (isAdmin) load();
  }, [isAdmin, load]);

  async function markDone(id: string) {
    setBusy(id);
    try {
      const res = await fetch(`/api/admin/support/${encodeURIComponent(id)}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ status: 'done' }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: { message: string } };
        throw new Error(body.error?.message ?? `The message was not marked done (${res.status}).`);
      }
      load();
    } catch (e) {
      setFailure(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }

  if (!isAdmin) {
    return (
      <Notice kind="info" title="Administrators only">
        <p className="small">Support messages are read by administrators.</p>
      </Notice>
    );
  }

  return (
    <section>
      <h2>Support messages</h2>
      <p className="small muted">
        Messages sent from the Help page. Contact the person by phone or email, then mark the
        message done.
      </p>
      <div style={{ display: 'flex', gap: 8, marginBlock: 12 }}>
        <Button
          size="small"
          variant={status === 'new' ? 'primary' : 'secondary'}
          aria-pressed={status === 'new'}
          onClick={() => setStatus('new')}
        >
          New
        </Button>
        <Button
          size="small"
          variant={status === 'done' ? 'primary' : 'secondary'}
          aria-pressed={status === 'done'}
          onClick={() => setStatus('done')}
        >
          Done
        </Button>
        <Button
          size="small"
          variant={appealsOnly ? 'primary' : 'secondary'}
          aria-pressed={appealsOnly}
          onClick={() => setAppealsOnly((v) => !v)}
        >
          Appeals
        </Button>
      </div>
      {failure ? (
        <Notice kind="error">
          <p className="small">{failure}</p>
        </Notice>
      ) : null}
      {rows === null ? (
        <p className="muted">Loading…</p>
      ) : rows.length === 0 ? (
        <Notice kind="info" title={status === 'new' ? 'Nothing new' : 'None done yet'}>
          <p className="small">
            {appealsOnly
              ? status === 'new'
                ? 'No appeal is waiting.'
                : 'No appeal has been marked done.'
              : status === 'new'
                ? 'No message is waiting.'
                : 'No message has been marked done.'}
          </p>
        </Notice>
      ) : (
        <ul style={{ listStyle: 'none', padding: 0, display: 'grid', gap: 12 }}>
          {rows.map((m) => (
            <li
              key={m.id}
              style={{ border: '1px solid var(--line)', borderRadius: 8, padding: 12 }}
            >
              <p>
                <strong dir="auto">{m.name}</strong>
                <span className="small muted"> · {FROM_LABEL[m.from_kind]}</span>
              </p>
              <p className="small">
                {m.phone ? <span className="mono">{m.phone}</span> : null}
                {m.phone && m.email ? ' · ' : null}
                {m.email ? <span>{m.email}</span> : null}
              </p>
              <p className="small">
                {TOPIC_LABEL[m.topic]} ·{' '}
                <Stamp kind={m.status === 'done' ? 'verified' : 'pending'}>
                  {m.status === 'done' ? 'Done' : 'New'}
                </Stamp>{' '}
                · sent {formatDate(m.created_at)}
                {m.handled_at ? ` · done ${formatDate(m.handled_at)}` : null}
              </p>
              <p dir="auto" style={{ whiteSpace: 'pre-wrap' }}>
                {m.body}
              </p>
              {m.topic === 'appeal' ? (
                m.account ? (
                  <p className="small">
                    <Link href={accountHref(m.account)}>
                      {m.account.kind === 'farmer'
                        ? 'Open the farmer record'
                        : 'Open in Buyer accounts'}
                    </Link>
                    {m.account.suspended ? ' · suspended now' : ' · not suspended'}
                    {m.account.matched_by === 'phone'
                      ? ' · found by the phone number given; check it is the same person'
                      : ''}
                    . Restore is there; then mark this message done.
                  </p>
                ) : (
                  <p className="small muted">
                    No account could be matched to this appeal. Find it by the name or phone above.
                  </p>
                )
              ) : null}
              {m.status === 'new' ? (
                <Button
                  size="small"
                  variant="secondary"
                  disabled={busy === m.id}
                  onClick={() => void markDone(m.id)}
                >
                  Mark done
                </Button>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
