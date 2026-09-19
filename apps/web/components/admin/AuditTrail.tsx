'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';

import { LIVE_ADMIN, listAudit, type AuditEvent } from '@/lib/admin/api';
import {
  DAMAGED_ID_LABEL,
  DAMAGED_ID_NOTE,
  KNOWN_ENTITY_KINDS,
  actionLabel,
  actorIdLooksValid,
  actorLabel,
  auditChips,
  changeSummary,
  clearAuditFilters,
  entityLabel,
  fieldChanges,
  fromQuery,
  hasAuditFilters,
  isDamagedId,
  toAuditParams,
} from '@/lib/admin/audit-view';
import { AUDIT_FIXTURE } from '@/lib/admin/fixtures';
import { usePreview } from '@/lib/preview';
import { useQueryState } from '@/lib/query-state';

import { Button, Dialog, Field, Input, Notice, PageHeader, Select } from '../ui';
import { DataTable, LoadingState, Pagination, UnavailableState } from '../ui/data';
import styles from './admin.module.css';

/**
 * THE AUDIT LOG — an administrator's search tool, not a feed.
 *
 * It answers one question, asked after the fact: who changed what, when, and
 * how. It is therefore FILTER → RESULTS → DETAIL, with no metric cards, no
 * charts and no sense of "latest activity", because nobody watches this page.
 *
 * ADMINISTRATORS ONLY, IN BOTH PLACES. `GET /api/audit` declares
 * `roles: ['admin']` and refuses everyone else; the navigation offers the
 * destination to nobody else; and this component refuses to render the
 * workspace for a non-administrator who reached the URL directly. The server
 * remains the authority — the guard here exists so a supervisor is not shown
 * a search form that can only ever answer 403.
 *
 * NOTHING HERE CHANGES THE LOG. `audit_event` is append-only: a database
 * trigger refuses UPDATE and DELETE, and no route offers either. So there is
 * no edit, no delete, no clear, no "mark as reviewed", and no export — no
 * audit-export endpoint exists, and the reporting export is for farmer and
 * summary data, not this.
 */
export function AuditTrail() {
  const { role, hydrated } = usePreview();
  const { get, set } = useQueryState();

  const urlState = useMemo(() => fromQuery(get), [get]);
  const [draft, setDraft] = useState(urlState);
  const [events, setEvents] = useState<readonly AuditEvent[]>(LIVE_ADMIN ? [] : AUDIT_FIXTURE);
  const [cursor, setCursor] = useState<string | null>(null);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [back, setBack] = useState<Array<string | null>>([]);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(LIVE_ADMIN);
  const [error, setError] = useState<string | undefined>();
  const [detail, setDetail] = useState<AuditEvent | null>(null);
  const [attempt, setAttempt] = useState(0);

  const isAdmin = hydrated && role === 'admin';

  useEffect(() => {
    setDraft(urlState);
  }, [urlState]);

  const params = useMemo(() => toAuditParams(urlState, cursor ?? undefined), [urlState, cursor]);
  const paramsKey = JSON.stringify(params);

  useEffect(() => {
    if (!LIVE_ADMIN || !isAdmin) return;
    let live = true;
    setLoading(true);
    listAudit({ ...(JSON.parse(paramsKey) as object), limit: 25 })
      .then((result) => {
        if (!live) return;
        setEvents(result.events);
        setNextCursor(result.cursor);
        setHasMore(result.hasMore);
        setError(undefined);
      })
      .catch((err: unknown) => {
        // A failed request is not a reason to send anybody to sign-in: the
        // session is the middleware's business. Report it and offer a retry.
        if (live) setError(err instanceof Error ? err.message : 'Could not load this information.');
      })
      .finally(() => live && setLoading(false));
    return () => {
      live = false;
    };
  }, [paramsKey, isAdmin, attempt]);

  /** A new query is a new search: the cursor belonged to the old one. */
  const apply = useCallback(() => {
    setCursor(null);
    setBack([]);
    set({ ...draft });
  }, [draft, set]);

  const clear = useCallback(() => {
    setCursor(null);
    setBack([]);
    set(clearAuditFilters());
  }, [set]);

  const removeChip = useCallback(
    (key: string) => {
      setCursor(null);
      setBack([]);
      set({ [key]: null });
    },
    [set],
  );

  if (!hydrated) return null;

  if (!isAdmin) {
    return (
      <div className={styles.page}>
        <PageHeader eyebrow="Governance" title="Audit log" />
        <UnavailableState title="The audit log is not available to your role">
          Reading who changed what across the whole system is reserved to administrators (C-4.8).
          Your own work is unaffected.
        </UnavailableState>
      </div>
    );
  }

  const chips = auditChips(urlState);
  const shown = LIVE_ADMIN ? events : [...events];

  return (
    <div className={styles.page}>
      <PageHeader
        eyebrow="Governance"
        title="Audit log"
        subtitle="Search recorded administrative and system changes. Every create, update and removal is written here in the same transaction as the change itself, and nothing can edit or remove an entry."
      />

      {/* ---- The four filters the route accepts ------------------------ */}
      <section className={styles.section} aria-labelledby="audit-search">
        <h2 id="audit-search" className="visually-hidden">
          Search the audit log
        </h2>
        <div className={styles.auditFilters}>
          <Field label="Record kind">
            {(ids) => (
              <Select
                {...ids}
                value={draft.entity_type}
                onChange={(e) => setDraft({ ...draft, entity_type: e.target.value })}
              >
                <option value="">Any kind</option>
                {KNOWN_ENTITY_KINDS.map((kind) => (
                  <option key={kind} value={kind}>
                    {entityLabel(kind)}
                  </option>
                ))}
              </Select>
            )}
          </Field>

          {/*
           * A record is looked up by its IDENTIFIER, never by a person's name.
           * There is no name search on this route, and putting a farmer's name
           * into a query string would be the very disclosure the log's own
           * rules forbid.
           */}
          <Field label="Record identifier" hint="The record's id, exactly as stored.">
            {(ids) => (
              <Input
                {...ids}
                className="mono"
                value={draft.entity_id}
                onChange={(e) => setDraft({ ...draft, entity_id: e.target.value })}
              />
            )}
          </Field>

          <Field
            label="Actor"
            hint="The staff or officer id that performed the action."
            error={
              actorIdLooksValid(draft.actor_id)
                ? undefined
                : 'Enter a full identifier, or clear the field.'
            }
          >
            {(ids) => (
              <Input
                {...ids}
                className="mono"
                value={draft.actor_id}
                onChange={(e) => setDraft({ ...draft, actor_id: e.target.value })}
              />
            )}
          </Field>

          <Field label="From" hint="Events recorded on this date or later.">
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

          <Field label="To" hint="Through the end of this date.">
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
          <Button onClick={apply} disabled={!actorIdLooksValid(draft.actor_id)}>
            Search
          </Button>
          <Button variant="secondary" onClick={clear}>
            Clear filters
          </Button>
        </div>

        {chips.length > 0 ? (
          <div className={styles.auditChips}>
            {chips.map((chip) => (
              <span key={chip.key} className={styles.auditChip}>
                {chip.label}
                <button
                  type="button"
                  className={styles.auditChipRemove}
                  onClick={() => removeChip(chip.key)}
                  aria-label={`Remove filter ${chip.label}`}
                >
                  ×
                </button>
              </span>
            ))}
          </div>
        ) : null}
      </section>

      {/* ---- Results --------------------------------------------------- */}
      <p className={styles.auditCount} aria-live="polite">
        {loading
          ? 'Searching…'
          : `${shown.length} ${shown.length === 1 ? 'event' : 'events'} shown${
              hasMore ? ' · more available' : ''
            }`}
      </p>

      {error ? (
        <Notice kind="error" title="Could not load this information">
          <p className="small">
            The audit log could not be read just now.{' '}
            <Button variant="ghost" size="small" onClick={() => setAttempt((n) => n + 1)}>
              Try again
            </Button>
          </p>
        </Notice>
      ) : loading ? (
        <LoadingState rows={5} label="Searching the audit log" />
      ) : shown.length === 0 ? (
        <Notice
          kind="info"
          title={
            hasAuditFilters(urlState) ? 'No audit events match these filters' : 'No audit events'
          }
        >
          <p className="small">
            {hasAuditFilters(urlState) ? (
              <>
                Nothing recorded matches this search.{' '}
                <Button variant="ghost" size="small" onClick={clear}>
                  Clear filters
                </Button>
              </>
            ) : (
              'No audit events are recorded in the range this page can read.'
            )}
          </p>
        </Notice>
      ) : (
        <>
          <DataTable
            caption="Recorded changes, newest first"
            rows={shown}
            rowKey={(e) => e.id}
            columns={[
              {
                key: 'when',
                header: 'When',
                nowrap: true,
                rowHeader: true,
                render: (e) => new Date(e.occurred_at).toLocaleString('en-GB'),
              },
              {
                key: 'actor',
                header: 'Actor',
                nowrap: true,
                render: (e) => (
                  <>
                    {actorLabel(e.actor_type)}
                    {e.actor_id ? (
                      <span className={styles.auditMono}>{e.actor_id.slice(0, 8)}</span>
                    ) : null}
                  </>
                ),
              },
              { key: 'action', header: 'Action', render: (e) => actionLabel(e.action) },
              {
                key: 'kind',
                header: 'Record kind',
                nowrap: true,
                render: (e) => entityLabel(e.entity_type),
              },
              {
                key: 'record',
                header: 'Record',
                nowrap: true,
                render: (e) =>
                  isDamagedId(e.entity_id) ? (
                    <span className={styles.auditDamaged} title={DAMAGED_ID_NOTE}>
                      {DAMAGED_ID_LABEL}
                    </span>
                  ) : (
                    <span className={styles.auditMono}>{e.entity_id}</span>
                  ),
              },
              { key: 'changes', header: 'Changed', render: (e) => changeSummary(e) },
              {
                key: 'open',
                header: 'Detail',
                printHidden: true,
                nowrap: true,
                render: (e) => (
                  <Button variant="secondary" size="small" onClick={() => setDetail(e)}>
                    Inspect
                  </Button>
                ),
              },
            ]}
          />

          {LIVE_ADMIN ? (
            <Pagination
              shown={shown.length}
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
          ) : null}
        </>
      )}

      {/* ---- One event, in full --------------------------------------- */}
      <Dialog
        open={detail !== null}
        onClose={() => setDetail(null)}
        title="Audit event"
        footer={
          <Button variant="ghost" onClick={() => setDetail(null)}>
            Close
          </Button>
        }
      >
        {detail ? (
          <>
            <dl className={styles.auditFacts}>
              <dt>When</dt>
              <dd>{new Date(detail.occurred_at).toLocaleString('en-GB')}</dd>
              <dt>Actor</dt>
              <dd>
                {actorLabel(detail.actor_type)}
                {detail.actor_id ? (
                  <span className={styles.auditMono}>{detail.actor_id}</span>
                ) : null}
              </dd>
              <dt>Action</dt>
              <dd>{actionLabel(detail.action)}</dd>
              <dt>Record kind</dt>
              <dd>{entityLabel(detail.entity_type)}</dd>
              <dt>Record</dt>
              <dd>
                {isDamagedId(detail.entity_id) ? (
                  <span className={styles.auditDamaged}>{DAMAGED_ID_LABEL}</span>
                ) : (
                  <span className={styles.auditMono}>{detail.entity_id}</span>
                )}
              </dd>
              {detail.device_id ? (
                <>
                  <dt>Device</dt>
                  <dd className={styles.auditMono}>{detail.device_id}</dd>
                </>
              ) : null}
            </dl>

            {isDamagedId(detail.entity_id) ? (
              <Notice kind="info" title={DAMAGED_ID_LABEL}>
                <p className="small">{DAMAGED_ID_NOTE}</p>
              </Notice>
            ) : null}

            {/*
             * Before and after as a table, labelled in words — not colour, and
             * not raw JSON. A field the denylist refuses still appears by name,
             * so the reader knows the change reached it, with its value
             * withheld rather than printed.
             */}
            <h3 className={styles.auditSubhead}>What changed</h3>
            {fieldChanges(detail).length === 0 ? (
              <p className="small muted">No field changes were recorded for this event.</p>
            ) : (
              <table className={styles.auditDiff}>
                <caption className="visually-hidden">
                  Field values before and after this change
                </caption>
                <thead>
                  <tr>
                    <th scope="col">Field</th>
                    <th scope="col">Before</th>
                    <th scope="col">After</th>
                  </tr>
                </thead>
                <tbody>
                  {fieldChanges(detail).map((change) => (
                    <tr key={change.field}>
                      <th scope="row">{change.field.replace(/_/g, ' ')}</th>
                      {change.withheld ? (
                        <td colSpan={2} className="muted">
                          Value withheld — this field is never shown in the audit log.
                        </td>
                      ) : (
                        <>
                          <td>{change.before ?? <span className="muted">Not set</span>}</td>
                          <td>{change.after ?? <span className="muted">Not set</span>}</td>
                        </>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </>
        ) : null}
      </Dialog>
    </div>
  );
}
