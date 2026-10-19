'use client';

import { useCallback, useEffect, useState } from 'react';

import { Button, Notice, Stamp } from '@/components/ui';
import { formatDate } from '@/lib/format';
import { usePreview } from '@/lib/preview';
import { reasonLabel, statusLabel, statusTone } from '@/components/product-reports/presentation';

interface MarketReport {
  id: string;
  target_type: 'buying_request' | 'service_listing' | string;
  target_id: string;
  target_title?: string;
  poster_name?: string;
  target_status?: string;
  reason: string;
  status: string;
  created_at: string;
}

const TARGET_LABEL: Record<string, string> = {
  buying_request: 'Buying request',
  service_listing: 'Service',
};

/** Decisions the server allows from each report status (it checks them again). */
const ACTIONS: Record<string, ReadonlyArray<{ action: string; label: string }>> = {
  new: [
    { action: 'mark_reviewing', label: 'Reviewing' },
    { action: 'dismiss', label: 'Dismiss' },
    { action: 'remove_listing', label: 'Remove post' },
  ],
  reviewing: [
    { action: 'resolve', label: 'Resolve' },
    { action: 'dismiss', label: 'Dismiss' },
    { action: 'remove_listing', label: 'Remove post' },
  ],
};

/**
 * LISTINGS LANE (2026-10-19). Reports about buying requests and service
 * listings, beside the product-report queue. Administrator only (the routes
 * refuse anyone else). "Remove post" removes it softly and settles the report;
 * no reporter identity exists to show.
 */
export function MarketReports() {
  const { role, hydrated } = usePreview();
  const isAdmin = hydrated && role === 'admin';
  const [rows, setRows] = useState<MarketReport[] | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(() => {
    fetch('/api/admin/market-reports?limit=100')
      .then(async (res) => {
        const body = (await res.json().catch(() => ({}))) as {
          data?: MarketReport[];
          error?: { message: string };
        };
        if (!res.ok)
          throw new Error(body.error?.message ?? `The queue could not be read (${res.status}).`);
        setRows(body.data ?? []);
        setFailure(null);
      })
      .catch((e: unknown) => {
        setRows([]);
        setFailure(e instanceof Error ? e.message : String(e));
      });
  }, []);

  useEffect(() => {
    if (isAdmin) load();
  }, [isAdmin, load]);

  async function decide(id: string, action: string) {
    setBusy(id);
    try {
      const res = await fetch(`/api/admin/market-reports/${encodeURIComponent(id)}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: { message: string } };
        throw new Error(body.error?.message ?? `The decision was not recorded (${res.status}).`);
      }
      load();
    } catch (e) {
      setFailure(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }

  if (!isAdmin) return null;

  return (
    <section style={{ marginBlockStart: 'var(--s-6, 32px)' }}>
      <h2>Buying requests and services reported</h2>
      <p className="small muted">
        Reports from marketplace visitors about buying requests and service listings.
      </p>
      {failure ? (
        <Notice kind="error">
          <p className="small">{failure}</p>
        </Notice>
      ) : null}
      {rows === null ? (
        <p className="muted">Loading…</p>
      ) : rows.length === 0 ? (
        <Notice kind="info" title="No reports">
          <p className="small">No buying request or service has been reported.</p>
        </Notice>
      ) : (
        <ul style={{ listStyle: 'none', padding: 0, display: 'grid', gap: 12 }}>
          {rows.map((r) => (
            <li
              key={r.id}
              style={{ border: '1px solid var(--line)', borderRadius: 8, padding: 12 }}
            >
              <p>
                <strong>{TARGET_LABEL[r.target_type] ?? r.target_type}:</strong>{' '}
                <span dir="auto">{r.target_title ?? 'Removed'}</span>
                {r.poster_name ? (
                  <span className="small muted" dir="auto">
                    {' '}
                    · {r.poster_name}
                  </span>
                ) : null}
              </p>
              <p className="small">
                {reasonLabel(r.reason)} ·{' '}
                <Stamp kind={statusTone(r.status)}>{statusLabel(r.status)}</Stamp> · reported{' '}
                {formatDate(r.created_at)}
              </p>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                {(ACTIONS[r.status] ?? []).map((a) => (
                  <Button
                    key={a.action}
                    size="small"
                    variant={a.action === 'remove_listing' ? 'danger' : 'secondary'}
                    disabled={busy === r.id}
                    onClick={() => void decide(r.id, a.action)}
                  >
                    {a.label}
                  </Button>
                ))}
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
