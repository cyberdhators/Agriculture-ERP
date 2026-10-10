'use client';

import { useCallback, useEffect, useState } from 'react';

import { Button, ButtonLink, Notice } from '@/components/ui';
import { FarmerApiError, farmerApi, useFarmerSession } from '@/lib/farmer-session';
import { formatDate, formatPhone } from '@/lib/format';
import { enqueue, queuedOf, subscribeOutbox } from '@/lib/offline/outbox';
import { loadWithSnapshot, saveSnapshot } from '@/lib/offline/snapshot';

import styles from './farmer.module.css';

/** A buyer's request as GET /api/farmer/requests returns it. */
interface IncomingRequest {
  id: string;
  listing_id: string;
  listing_title: string;
  product_name: string;
  quantity: number;
  unit: string;
  delivery_location: string;
  required_by: string | null;
  notes: string | null;
  status: string;
  submitted_at: string | null;
  answer_note: string | null;
  answered_at: string | null;
  buyer: { name: string; phone: string | null; organization: string | null };
}

const W = {
  en: {
    title: 'Requests from buyers',
    empty: 'No buyer has sent you a request yet. Buyers find your produce in the market.',
    deliver: 'Deliver to',
    by: 'needed by',
    call: 'Call',
    whatsapp: 'WhatsApp',
    accept: 'Accept',
    decline: 'Decline',
    submitted: 'New',
    under_review: 'New',
    accepted: 'You accepted',
    rejected: 'You declined',
    cancelled: 'Cancelled by the buyer',
    converted: 'Agreed',
    lead: 'Call or message the buyer to agree the price and the handover.',
    waiting: 'waiting to send',
    savedCopy: 'No signal. Showing the list saved on this phone at',
  },
  ar: {
    title: 'طلبات المشترين',
    empty: 'لم يرسل لك أي مشترٍ طلباً بعد. يجد المشترون منتجاتك في السوق.',
    deliver: 'التسليم إلى',
    by: 'مطلوب بحلول',
    call: 'اتصال',
    whatsapp: 'واتساب',
    accept: 'قبول',
    decline: 'رفض',
    submitted: 'جديد',
    under_review: 'جديد',
    accepted: 'قبلت',
    rejected: 'رفضت',
    cancelled: 'ألغاه المشتري',
    converted: 'تم الاتفاق',
    lead: 'اتصل بالمشتري أو راسله للاتفاق على السعر والتسليم.',
    waiting: 'في انتظار الإرسال',
    savedCopy: 'لا توجد إشارة. القائمة المحفوظة على هذا الهاتف في',
  },
} as const;

const OPEN = new Set(['submitted', 'under_review']);

function waLink(phone: string): string {
  return `https://wa.me/${phone.replace(/\D/g, '')}`;
}

/**
 * The farmer's inbox of buyer requests (B14). A buyer who sends a request is
 * shown here with their phone, and given the farmer's; the two deal directly.
 * Accepting or declining tells the buyer; neither creates an order.
 */
export function FarmerRequests({ limit }: { limit?: number }) {
  const { language } = useFarmerSession();
  const w = W[language === 'ar' ? 'ar' : 'en'];
  const [requests, setRequests] = useState<IncomingRequest[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  /** PWA: answers saved on this phone, not yet sent. */
  const [pending, setPending] = useState<ReadonlySet<string>>(new Set());
  /** PWA: when the list shown was saved, if it came from this phone. */
  const [savedAt, setSavedAt] = useState<number | null>(null);

  const load = useCallback(async () => {
    try {
      // PWA (2026-10-10): with no signal, the list saved on this phone.
      const got = await loadWithSnapshot(
        'farmer.requests',
        () => farmerApi<IncomingRequest[]>('/api/farmer/requests'),
        (e) => e instanceof FarmerApiError && e.status === 0,
      );
      const queued = await queuedOf('request-answer');
      const answers = new Map(
        queued.map((q) => [
          q.id.replace(/^answer:/, ''),
          (q.body as { answer?: string } | undefined)?.answer === 'accept'
            ? 'accepted'
            : 'rejected',
        ]),
      );
      setPending(new Set(answers.keys()));
      setSavedAt(got && !got.fresh ? got.savedAt : null);
      setRequests(
        (got?.data ?? []).map((r) =>
          answers.has(r.id) ? { ...r, status: answers.get(r.id)! } : r,
        ),
      );
    } catch (e) {
      setError(e instanceof FarmerApiError ? e.message : String(e));
      setRequests([]);
    }
  }, []);

  useEffect(() => {
    void load();
    // When the outbox sends an answer, reload to show the server's state.
    let before = -1;
    const off = subscribeOutbox(() => {
      void queuedOf('request-answer').then((q) => {
        if (before >= 0 && q.length < before) void load();
        before = q.length;
      });
    });
    return off;
  }, [load]);

  async function answer(id: string, value: 'accept' | 'decline') {
    setBusy(id);
    setError(null);
    // PWA (2026-10-10): with no signal the answer is saved on this phone and
    // sent later. The same answer sent twice is accepted by the server.
    const queue = async () => {
      const r = (requests ?? []).find((x) => x.id === id);
      await enqueue({
        id: `answer:${id}`,
        kind: 'request-answer',
        label: `${value === 'accept' ? 'Accept' : 'Decline'}: ${r?.buyer.name ?? 'buyer'} -- ${r?.product_name ?? ''}`,
        method: 'PATCH',
        path: `/api/farmer/requests/${id}`,
        body: { answer: value },
      });
      const status = value === 'accept' ? 'accepted' : 'rejected';
      setPending((p) => new Set(p).add(id));
      setRequests((list) => (list ?? []).map((x) => (x.id === id ? { ...x, status } : x)));
    };
    try {
      if (typeof navigator !== 'undefined' && !navigator.onLine) {
        await queue();
        return;
      }
      const updated = await farmerApi<IncomingRequest>(`/api/farmer/requests/${id}`, {
        method: 'PATCH',
        body: JSON.stringify({ answer: value }),
      });
      const next = (requests ?? []).map((r) => (r.id === id ? updated : r));
      setRequests(next);
      await saveSnapshot('farmer.requests', next);
    } catch (e) {
      if (e instanceof FarmerApiError && e.status === 0) {
        await queue();
        return;
      }
      setError(e instanceof FarmerApiError ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }

  const shown = requests ? (limit ? requests.slice(0, limit) : requests) : [];
  const fresh = (requests ?? []).filter((r) => OPEN.has(r.status)).length;

  return (
    <section style={{ marginBottom: 'var(--s-5)' }}>
      <div className={styles.blockHead}>
        <h2>{w.title}</h2>
        <span className="small muted">
          {fresh > 0 ? `${fresh} ${w.submitted}` : (requests?.length ?? '…')}
        </span>
      </div>
      {savedAt ? (
        <p className="small muted">
          {w.savedCopy}{' '}
          {new Date(savedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
        </p>
      ) : null}
      {error ? <Notice kind="error" title={error} /> : null}
      {requests && requests.length === 0 ? <p className="small muted">{w.empty}</p> : null}
      {shown.length > 0 ? (
        <>
          <p className="small muted">{w.lead}</p>
          <ul className={styles.learnList}>
            {shown.map((r) => (
              <li key={r.id} className={styles.learnItem} style={{ gridTemplateColumns: '1fr' }}>
                <div className={styles.learnText}>
                  <div className={styles.learnTitle} dir="auto">
                    {r.buyer.name}
                    {r.buyer.organization ? ` (${r.buyer.organization})` : ''} · {r.product_name}
                  </div>
                  <div className="small" dir="auto">
                    <span className="mono">
                      {r.quantity} {r.unit}
                    </span>
                    {' · '}
                    {w.deliver} {r.delivery_location}
                    {r.required_by ? ` · ${w.by} ${formatDate(r.required_by, language)}` : ''}
                  </div>
                  {r.notes ? (
                    <div className="small muted" dir="auto">
                      “{r.notes}”
                    </div>
                  ) : null}
                  <div className="small muted">
                    {r.submitted_at ? formatDate(r.submitted_at, language) : ''} ·{' '}
                    <strong>{w[r.status as keyof typeof w] ?? r.status}</strong>
                    {pending.has(r.id) ? <em> · {w.waiting}</em> : null}
                  </div>
                  <div
                    style={{
                      display: 'flex',
                      gap: 'var(--s-2)',
                      flexWrap: 'wrap',
                      marginTop: 'var(--s-2)',
                    }}
                  >
                    {r.buyer.phone ? (
                      <>
                        <ButtonLink href={`tel:${r.buyer.phone}`} variant="secondary">
                          {w.call} {formatPhone(r.buyer.phone)}
                        </ButtonLink>
                        <ButtonLink href={waLink(r.buyer.phone)} variant="secondary">
                          {w.whatsapp}
                        </ButtonLink>
                      </>
                    ) : null}
                    {OPEN.has(r.status) ? (
                      <>
                        <Button
                          variant="primary"
                          disabled={busy === r.id}
                          onClick={() => void answer(r.id, 'accept')}
                        >
                          {w.accept}
                        </Button>
                        <Button
                          variant="secondary"
                          disabled={busy === r.id}
                          onClick={() => void answer(r.id, 'decline')}
                        >
                          {w.decline}
                        </Button>
                      </>
                    ) : null}
                  </div>
                </div>
              </li>
            ))}
          </ul>
        </>
      ) : null}
    </section>
  );
}
