'use client';

import {
  ACCESS_EVENTS,
  ACCESS_EVENT_LABELS,
  ACCESS_PRINCIPAL_KINDS,
  DEVICE_LABEL_TEXT,
  type DeviceLabel,
} from '@agri-erp/shared';
import { useEffect, useState } from 'react';

import {
  ACTOR_KIND_LABELS,
  accountLabel,
  formatJubaTime,
  jubaDayBound,
} from '@/lib/admin/access-view';
import {
  type AccessLogEntry,
  type AccessLogQuery,
  StaffAccessError,
  listAccessLogs,
} from '@/lib/admin/staff-access-api';

import { Button, Field, Input, Notice, PageHeader, Select } from '../ui';
import { DataTable, LoadingState, Pagination, UnavailableState } from '../ui/data';
import styles from './admin.module.css';

/**
 * ACCESS LOGS (2026-10-19). Per account: created, first sign-in, sign-ins,
 * return sessions, failed re-authentication, and last activity.
 *
 * Behind `audit.view`, platform-wide -- enforced by GET /api/admin/access-logs,
 * not by this screen, which only says so when the route refuses. Times are
 * shown in Juba time. Farmers and buyers appear by kind and a short id, never
 * by name. Nothing here can change the log: it is append-only.
 */

interface Draft {
  name: string;
  actor_kind: string;
  actor_id: string;
  event: string;
  from: string;
  to: string;
}

const EMPTY: Draft = { name: '', actor_kind: '', actor_id: '', event: '', from: '', to: '' };

const toQuery = (d: Draft): AccessLogQuery => ({
  name: d.name.trim() || undefined,
  actor_kind: d.actor_kind || undefined,
  actor_id: d.actor_id.trim() || undefined,
  event: d.event || undefined,
  from: d.from ? jubaDayBound(d.from, 'start') : undefined,
  to: d.to ? jubaDayBound(d.to, 'end') : undefined,
});

export function AccessLogs() {
  const [draft, setDraft] = useState<Draft>(EMPTY);
  const [applied, setApplied] = useState<Draft>(EMPTY);
  const [rows, setRows] = useState<AccessLogEntry[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [back, setBack] = useState<Array<string | null>>([]);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<{ status: number; message: string } | undefined>();
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let live = true;
    setLoading(true);
    listAccessLogs({ ...toQuery(applied), ...(cursor ? { cursor } : {}), limit: 25 })
      .then((result) => {
        if (!live) return;
        setRows(result.rows);
        setNextCursor(result.cursor);
        setHasMore(result.hasMore);
        setError(undefined);
      })
      .catch((e: unknown) => {
        if (!live) return;
        setError({
          status: e instanceof StaffAccessError ? e.status : 0,
          message: e instanceof StaffAccessError ? e.message : 'Could not load this information.',
        });
      })
      .finally(() => live && setLoading(false));
    return () => {
      live = false;
    };
  }, [applied, cursor, attempt]);

  const search = () => {
    setCursor(null);
    setBack([]);
    setApplied(draft);
  };
  const clear = () => {
    setDraft(EMPTY);
    setCursor(null);
    setBack([]);
    setApplied(EMPTY);
  };

  if (error?.status === 403) {
    return (
      <div className={styles.page}>
        <PageHeader eyebrow="Governance" title="Access logs" />
        <UnavailableState title="Not available to your account">
          Reading access logs needs the audit-view permission across the whole platform.
        </UnavailableState>
      </div>
    );
  }

  return (
    <div className={styles.page}>
      <PageHeader
        eyebrow="Governance"
        title="Access logs"
        subtitle="When each account was created, signed in, came back to an open session, or failed to re-authenticate. Times are in Juba time. No IP address or browser details are kept."
      />

      <section className={styles.section} aria-labelledby="access-search">
        <h2 id="access-search" className="visually-hidden">
          Search the access logs
        </h2>
        <div className={styles.auditFilters}>
          <Field label="Name" hint="Staff and officers only.">
            {(ids) => (
              <Input
                {...ids}
                value={draft.name}
                onChange={(e) => setDraft({ ...draft, name: e.target.value })}
              />
            )}
          </Field>
          <Field label="Account kind">
            {(ids) => (
              <Select
                {...ids}
                value={draft.actor_kind}
                onChange={(e) => setDraft({ ...draft, actor_kind: e.target.value })}
              >
                <option value="">Any kind</option>
                {ACCESS_PRINCIPAL_KINDS.map((k) => (
                  <option key={k} value={k}>
                    {ACTOR_KIND_LABELS[k]}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <Field label="Account identifier" hint="The account's id, exactly as stored.">
            {(ids) => (
              <Input
                {...ids}
                className="mono"
                value={draft.actor_id}
                onChange={(e) => setDraft({ ...draft, actor_id: e.target.value })}
              />
            )}
          </Field>
          <Field label="Event">
            {(ids) => (
              <Select
                {...ids}
                value={draft.event}
                onChange={(e) => setDraft({ ...draft, event: e.target.value })}
              >
                <option value="">Any event</option>
                {ACCESS_EVENTS.map((ev) => (
                  <option key={ev} value={ev}>
                    {ACCESS_EVENT_LABELS[ev]}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <Field label="From" hint="Juba date.">
            {(ids) => (
              <Input
                {...ids}
                type="date"
                value={draft.from}
                max={draft.to || undefined}
                onChange={(e) => setDraft({ ...draft, from: e.target.value })}
              />
            )}
          </Field>
          <Field label="To" hint="Through the end of this day.">
            {(ids) => (
              <Input
                {...ids}
                type="date"
                value={draft.to}
                min={draft.from || undefined}
                onChange={(e) => setDraft({ ...draft, to: e.target.value })}
              />
            )}
          </Field>
        </div>
        <div className={styles.auditFilterFoot}>
          <Button onClick={search}>Search</Button>
          <Button variant="secondary" onClick={clear}>
            Clear filters
          </Button>
        </div>
      </section>

      {error ? (
        <Notice kind="error" title="Could not load this information">
          <p className="small">
            {error.message}{' '}
            <Button variant="ghost" size="small" onClick={() => setAttempt((n) => n + 1)}>
              Try again
            </Button>
          </p>
        </Notice>
      ) : loading ? (
        <LoadingState rows={5} label="Searching the access logs" />
      ) : rows.length === 0 ? (
        <Notice kind="info" title="No access events match">
          <p className="small">Nothing recorded matches this search.</p>
        </Notice>
      ) : (
        <>
          <DataTable
            caption="Access events, newest first"
            rows={rows}
            rowKey={(r) => r.id}
            columns={[
              {
                key: 'when',
                header: 'When (Juba)',
                nowrap: true,
                rowHeader: true,
                render: (r) => formatJubaTime(r.occurred_at),
              },
              {
                key: 'account',
                header: 'Account',
                render: (r) => (
                  <>
                    {accountLabel(r)}{' '}
                    <span className="muted small">{ACTOR_KIND_LABELS[r.actor_kind]}</span>
                  </>
                ),
              },
              { key: 'event', header: 'Event', render: (r) => ACCESS_EVENT_LABELS[r.event] },
              {
                key: 'device',
                header: 'Device',
                render: (r) =>
                  r.device_label ? (DEVICE_LABEL_TEXT[r.device_label as DeviceLabel] ?? '—') : '—',
              },
              {
                key: 'last',
                header: 'Last activity',
                nowrap: true,
                render: (r) => formatJubaTime(r.last_activity_at),
              },
            ]}
          />
          <Pagination
            shown={rows.length}
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
  );
}
