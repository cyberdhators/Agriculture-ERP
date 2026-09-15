'use client';

import { useEffect, useState } from 'react';

import { Button, Card, Notice } from '@/components/ui';
import {
  LIVE_CONTACT,
  listContactRequests,
  updateContactRequest,
  type ContactRequest,
  type ContactStatus,
} from '@/lib/contact/api';
import { usePreviewContactRequests } from '@/lib/contact/store';
import { LISTINGS, type Farmer } from '@/lib/fixtures/farmers';
import { formatDate, formatPhone } from '@/lib/format';

import styles from '../screens.module.css';

const OUTCOME: Record<ContactStatus, string> = {
  new: 'New',
  introduced: 'Introduced',
  declined: 'Declined',
  no_answer: 'No answer',
};

/**
 * The officer's queue of buyer requests for the farmers they hold — the
 * introduction that deliverable (g) is. Each row is a buyer who asked about
 * one listing; the officer calls the farmer, then the buyer, and records what
 * happened. Live: GET /api/contact-requests, scoped by the server to the
 * caseload; off live, this browser's preview store.
 */
export function BuyerRequests({
  caseload,
  officerId,
}: {
  caseload: readonly Farmer[];
  officerId: string | null;
}) {
  const preview = usePreviewContactRequests();
  const [live, setLive] = useState<ContactRequest[] | null>(null);
  const [error, setError] = useState<string | undefined>();
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => {
    if (!LIVE_CONTACT) return;
    let on = true;
    listContactRequests()
      .then((r) => on && setLive(r))
      .catch(
        (e: unknown) => on && setError(e instanceof Error ? e.message : 'Could not load requests.'),
      );
    return () => {
      on = false;
    };
  }, []);

  const mine = new Set(caseload.map((f) => f.id));
  const rows = (
    LIVE_CONTACT ? (live ?? []) : preview.requests.filter((r) => mine.has(r.farmer_id))
  ).filter((r) => r.status === 'new');
  const farmerOf = (id: string) => caseload.find((f) => f.id === id);
  const listingOf = (id: string) => LISTINGS.find((l) => l.id === id);

  async function record(id: string, status: Exclude<ContactStatus, 'new'>) {
    setBusy(id);
    try {
      if (LIVE_CONTACT) {
        const updated = await updateContactRequest(id, { status });
        setLive((list) => (list ?? []).map((r) => (r.id === id ? updated : r)));
      } else {
        preview.update(id, status, undefined, officerId ?? undefined);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not record that.');
    } finally {
      setBusy(null);
    }
  }

  return (
    <div style={{ marginBottom: 'var(--s-5)' }}>
      <Card as="section" padded>
        <p className="label" style={{ marginBottom: 'var(--s-2)' }}>
          Buyer requests · {rows.length}
        </p>
        <p className="small muted" style={{ marginBottom: 'var(--s-3)' }}>
          A buyer asked about a farmer you hold. Call the farmer, then the buyer, and record what
          happened. The farmer&apos;s number stays with you; the buyer never sees it.
        </p>
        {error ? (
          <Notice kind="error" title="Requests">
            <p className="small">{error}</p>
          </Notice>
        ) : null}
        {rows.length === 0 ? (
          <p className="small muted">No new requests.</p>
        ) : (
          <div className={styles.tableWrap}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th>Buyer</th>
                  <th>Wants</th>
                  <th>Farmer</th>
                  <th>Asked</th>
                  <th>Outcome</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  const f = farmerOf(r.farmer_id);
                  const l = listingOf(r.listing_id);
                  return (
                    <tr key={r.id}>
                      <td>
                        <div dir="auto">{r.buyer_name}</div>
                        <div className="small mono">{formatPhone(r.buyer_phone)}</div>
                      </td>
                      <td>
                        <div dir="auto">{l ? l.title : r.listing_id.slice(0, 8)}</div>
                        <div className="small muted" dir="auto">
                          {[r.quantity, r.message].filter(Boolean).join(' · ')}
                        </div>
                      </td>
                      <td className={styles.tdNowrap}>
                        {f ? (
                          <>
                            <div dir="auto">
                              {f.given_name} {f.family_name}
                            </div>
                            <div className="small mono">{formatPhone(f.phone)}</div>
                          </>
                        ) : (
                          <span className="muted">Not in your caseload</span>
                        )}
                      </td>
                      <td className={styles.tdNowrap}>{formatDate(r.created_at)}</td>
                      <td>
                        <div style={{ display: 'flex', gap: 'var(--s-2)', flexWrap: 'wrap' }}>
                          {(['introduced', 'declined', 'no_answer'] as const).map((s) => (
                            <Button
                              key={s}
                              variant={s === 'introduced' ? 'primary' : 'secondary'}
                              disabled={busy === r.id}
                              onClick={() => record(r.id, s)}
                            >
                              {OUTCOME[s]}
                            </Button>
                          ))}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
