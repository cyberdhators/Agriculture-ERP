'use client';

import { useCallback, useEffect, useState } from 'react';

import {
  RATING_NOTE_MAX,
  moderateRatingSchema,
  type ModerationRating,
  type RatingModerationFilter,
} from '@agri-erp/shared';

import { formatDate } from '@/lib/format';

import { reasonLabel } from '../product-reports/presentation';
import { Stars } from '../ratings/Ratings';
import { Button, EmptyState, Field, Notice, PageHeader, Stamp, Tabs, Textarea } from '../ui';
import { PageLoading } from '@/components/ui/data';

/**
 * RATINGS MODERATION (2026-11-03, lane-trust). Staff holding "Moderate
 * content and listings" read the ratings the rated party reported, and hide
 * one with a reason, restore a hidden one, or dismiss a report. A hidden
 * rating leaves every public profile and the average; nothing is deleted.
 * Every route behind this refuses anyone else.
 */

const FILTER_LABEL: Record<RatingModerationFilter, string> = {
  reported: 'Reported',
  hidden: 'Hidden',
  all: 'All ratings',
};

function RatingRow({ rating, onChanged }: { rating: ModerationRating; onChanged: () => void }) {
  const [hiding, setHiding] = useState(false);
  const [reason, setReason] = useState('');
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function act(action: 'hide' | 'restore' | 'dismiss_report') {
    const parsed = moderateRatingSchema.safeParse({
      action,
      ...(action === 'hide' ? { reason } : {}),
    });
    if (!parsed.success) {
      setProblem(parsed.error.issues[0]?.message ?? 'Check the form.');
      return;
    }
    setBusy(true);
    setProblem(null);
    try {
      const res = await fetch(`/api/admin/ratings/${encodeURIComponent(rating.id)}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(parsed.data),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: { message?: string } };
        setProblem(body.error?.message ?? `The change was not saved (${res.status}).`);
        return;
      }
      setHiding(false);
      onChanged();
    } catch {
      setProblem('The server could not be reached. Check the connection.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <li className="card" style={{ padding: 12, display: 'grid', gap: 6, minWidth: 0 }}>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
        <Stars value={rating.stars} />
        {rating.hidden_at ? <Stamp kind="rejected">Hidden</Stamp> : null}
        {rating.reported_at ? <Stamp kind="pending">Reported</Stamp> : null}
      </div>
      {rating.comment ? (
        <p dir="auto" style={{ margin: 0, overflowWrap: 'anywhere' }}>
          {rating.comment}
        </p>
      ) : (
        <p className="small muted">No comment.</p>
      )}
      <p className="small muted" style={{ margin: 0 }}>
        By {rating.rater_name ?? 'an AgriOne member'} about {rating.ratee_name ?? 'a member'} ·{' '}
        {rating.deal_kind === 'purchase_order' ? 'Completed order' : 'Completed post'} ·{' '}
        {formatDate(rating.created_at)}
      </p>
      {rating.reported_at ? (
        <p className="small" style={{ margin: 0 }}>
          Report: {reasonLabel(rating.report_reason ?? 'other')} · {formatDate(rating.reported_at)}
          {rating.report_note ? (
            <>
              {' '}
              · <span dir="auto">{rating.report_note}</span>
            </>
          ) : null}
        </p>
      ) : null}
      {rating.hidden_at ? (
        <p className="small" style={{ margin: 0 }}>
          Hidden {formatDate(rating.hidden_at)}: <span dir="auto">{rating.hidden_reason}</span>
        </p>
      ) : null}
      {hiding ? (
        <Field label="Reason for hiding (kept in the audit trail)">
          {(ids) => (
            <Textarea
              {...ids}
              rows={2}
              maxLength={RATING_NOTE_MAX}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
            />
          )}
        </Field>
      ) : null}
      {problem ? <Notice kind="error">{problem}</Notice> : null}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        {rating.hidden_at ? (
          <Button
            size="small"
            variant="secondary"
            disabled={busy}
            onClick={() => void act('restore')}
          >
            Restore
          </Button>
        ) : hiding ? (
          <>
            <Button size="small" variant="danger" disabled={busy} onClick={() => void act('hide')}>
              Hide rating
            </Button>
            <Button size="small" variant="ghost" onClick={() => setHiding(false)}>
              Cancel
            </Button>
          </>
        ) : (
          <Button size="small" variant="danger" onClick={() => setHiding(true)}>
            Hide…
          </Button>
        )}
        {rating.reported_at && !rating.hidden_at && !hiding ? (
          <Button
            size="small"
            variant="ghost"
            disabled={busy}
            onClick={() => void act('dismiss_report')}
          >
            Dismiss report
          </Button>
        ) : null}
      </div>
    </li>
  );
}

export function RatingsModeration() {
  const [filter, setFilter] = useState<RatingModerationFilter>('reported');
  const [rows, setRows] = useState<ModerationRating[] | null>(null);
  const [problem, setProblem] = useState<string | null>(null);

  const load = useCallback(() => {
    setProblem(null);
    fetch(`/api/admin/ratings?filter=${filter}`, { cache: 'no-store' })
      .then(async (res) => {
        const body = (await res.json().catch(() => ({}))) as {
          data?: ModerationRating[];
          error?: { message?: string };
        };
        if (!res.ok) throw new Error(body.error?.message ?? `Could not load (${res.status}).`);
        setRows(body.data ?? []);
      })
      .catch((e: unknown) => {
        setRows([]);
        setProblem(e instanceof Error ? e.message : 'Could not load the ratings.');
      });
  }, [filter]);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <div style={{ display: 'grid', gap: 12, maxWidth: 820, minWidth: 0 }}>
      <PageHeader
        title="Ratings"
        subtitle="A hidden rating leaves every profile and the average. Nothing is deleted."
      />
      <Tabs<RatingModerationFilter>
        label="Ratings"
        value={filter}
        onChange={(next) => {
          setRows(null);
          setFilter(next);
        }}
        items={(Object.keys(FILTER_LABEL) as RatingModerationFilter[]).map((key) => ({
          key,
          label: FILTER_LABEL[key],
        }))}
      />
      {problem ? <Notice kind="error">{problem}</Notice> : null}
      {rows === null ? (
        <PageLoading />
      ) : rows.length === 0 ? (
        <EmptyState
          title={filter === 'reported' ? 'No reported ratings' : 'No ratings here'}
          body="Nothing is waiting for a decision."
        />
      ) : (
        <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: 8 }}>
          {rows.map((r) => (
            <RatingRow key={r.id} rating={r} onChanged={load} />
          ))}
        </ul>
      )}
    </div>
  );
}
