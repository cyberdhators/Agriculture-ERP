'use client';

import { useEffect, useMemo, useState } from 'react';

import { LIVE_ADMIN, listAudit, type AuditEvent } from '@/lib/admin/api';
import { AUDIT_FIXTURE } from '@/lib/admin/fixtures';

import styles from './admin.module.css';

const ACTOR_LABEL: Record<string, string> = {
  admin: 'Administrator',
  supervisor: 'Supervisor',
  read_only: 'Read only',
  officer: 'Officer',
  system: 'System',
};

const ENTITY_LABEL: Record<string, string> = {
  farmer: 'Farmer',
  officer: 'Officer',
  user: 'Staff',
  cooperative: 'Cooperative',
  directory_entry: 'Directory',
  learning_resource: 'Library',
};

function actionLabel(action: string): string {
  const verb = action.split('.')[1] ?? action;
  return verb.replace(/_/g, ' ');
}

function fmtWhen(iso: string): string {
  return new Date(iso).toLocaleString('en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

/** A compact before→after so a reviewer sees what changed without reading JSON. */
function changeSummary(before: unknown, after: unknown): string {
  if (before == null && after && typeof after === 'object') {
    const keys = Object.keys(after as Record<string, unknown>);
    return keys.length ? `Created · ${keys.join(', ')}` : 'Created';
  }
  if (after == null) return 'Removed';
  if (before && after && typeof before === 'object' && typeof after === 'object') {
    const b = before as Record<string, unknown>;
    const a = after as Record<string, unknown>;
    const changed = Object.keys(a)
      .filter((k) => JSON.stringify(a[k]) !== JSON.stringify(b[k]))
      .map((k) => `${k}: ${String(b[k] ?? '—')} → ${String(a[k])}`);
    return changed.join(' · ') || '—';
  }
  return '—';
}

/**
 * The audit trail (deliverable (s), C-4): the append-only record of who created,
 * changed or deactivated what, newest first. Administrators only — a supervisor
 * reading across the whole system is what C-3.4 exists to deny, so the route
 * refuses them (C-4.8). Filter by what changed and by who. Reads `/api/audit`
 * when `NEXT_PUBLIC_USE_LIVE_ADMIN=1`, sample rows otherwise.
 */
export function AuditTrail() {
  const [events, setEvents] = useState<readonly AuditEvent[]>(LIVE_ADMIN ? [] : AUDIT_FIXTURE);
  const [loading, setLoading] = useState(LIVE_ADMIN);
  const [error, setError] = useState<string | undefined>();
  const [entity, setEntity] = useState('');

  useEffect(() => {
    if (!LIVE_ADMIN) return;
    let live = true;
    setLoading(true);
    listAudit(entity ? { entity_type: entity } : {})
      .then((r) => live && (setEvents(r.events), setError(undefined)))
      .catch((err: unknown) =>
        live ? setError(err instanceof Error ? err.message : 'Could not load the trail.') : null,
      )
      .finally(() => live && setLoading(false));
    return () => {
      live = false;
    };
  }, [entity]);

  const shown = useMemo(
    () => (LIVE_ADMIN || !entity ? events : events.filter((e) => e.entity_type === entity)),
    [events, entity],
  );

  const entityTypes = useMemo(
    () => Array.from(new Set(AUDIT_FIXTURE.map((e) => e.entity_type))),
    [],
  );

  return (
    <div className={styles.page}>
      <header className={styles.head}>
        <p className={styles.eyebrow}>Administration</p>
        <h1 className={styles.h1}>Audit trail</h1>
        <p className={styles.lede}>
          Every create, change and deactivation across the system, newest first. The record is
          append-only — it is never edited or deleted. Administrators only.
        </p>
      </header>

      <div className={styles.filterBar}>
        <label htmlFor="audit-entity" className={styles.filterLabel}>
          Record type
        </label>
        <select
          id="audit-entity"
          className={styles.filterSelect}
          value={entity}
          onChange={(e) => setEntity(e.target.value)}
        >
          <option value="">All records</option>
          {entityTypes.map((t) => (
            <option key={t} value={t}>
              {ENTITY_LABEL[t] ?? t}
            </option>
          ))}
        </select>
        <span className={styles.count}>{shown.length} events</span>
      </div>

      {error ? (
        <p className={styles.error} role="alert">
          {error}
        </p>
      ) : null}
      {loading ? <p className={styles.muted}>Loading the trail…</p> : null}

      <div className={styles.tableWrap}>
        <table className={styles.table}>
          <thead>
            <tr>
              <th>When</th>
              <th>Actor</th>
              <th>Action</th>
              <th>Record</th>
              <th>Change</th>
            </tr>
          </thead>
          <tbody>
            {shown.map((e) => (
              <tr key={e.id}>
                <td className={styles.num}>{fmtWhen(e.occurred_at)}</td>
                <td>{ACTOR_LABEL[e.actor_type] ?? e.actor_type}</td>
                <td className={styles.strong}>{actionLabel(e.action)}</td>
                <td>
                  {ENTITY_LABEL[e.entity_type] ?? e.entity_type}{' '}
                  <span className={styles.num}>{e.entity_id}</span>
                </td>
                <td className={styles.change}>{changeSummary(e.before, e.after)}</td>
              </tr>
            ))}
            {shown.length === 0 && !loading ? (
              <tr>
                <td colSpan={5} className={styles.empty}>
                  No audit events for this filter.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </div>
  );
}
