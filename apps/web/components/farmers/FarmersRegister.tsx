'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState } from 'react';

import { LIVE_FARMERS, listFarmers } from '@/lib/farmers/api';
import {
  EMPTY_FILTERS,
  STATUS_TABS,
  activeChips,
  clearPatch,
  fromQuery,
  hasActiveFilters,
  statusLabel,
  toListParams,
  type RegisterFilters,
} from '@/lib/farmers/filters';
import {
  canRegister,
  effectiveStatus,
  scopeFarmers,
  statusStamp,
  STATUS_LABEL,
} from '@/lib/farmers/presentation';
import {
  canSelect,
  printContext,
  printRowNote,
  prunedSelection,
  selectionLabel,
  toggleAllOnPage,
  toggleSelection,
} from '@/lib/farmers/register-view';
import { FARMERS, officerById, type Farmer } from '@/lib/fixtures/farmers';
import { formatDate, formatPhone } from '@/lib/format';
import { useLocationNames } from '@/lib/portal/locations';
import { usePreview } from '@/lib/preview';
import { useQueryState } from '@/lib/query-state';

import {
  Button,
  ButtonLink,
  Checkbox,
  Field,
  Input,
  Notice,
  PageHeader,
  Select,
  Stamp,
} from '../ui';
import { DataTable, Pagination } from '../ui/data';
import { IconPlus, IconPrint, IconWarn, IconX } from '../ui/icons';
import styles from './farmers.module.css';

/**
 * THE NATIONAL FARMER REGISTER.
 *
 * WHAT THIS REPLACES, AND WHY IT MATTERED. The register used to fetch two
 * hundred rows once and do every filter in the browser. On a national register
 * that is not a slow screen, it is a WRONG one: an administrator filtering for
 * pending farmers in Yei saw only those among the first two hundred rows the
 * server happened to return, and an empty result read as "none" rather than
 * "not on this page". Filtering now goes to the route, which is where the
 * whole register is, and paging uses the cursor the route returns.
 *
 * WHAT IT DELIBERATELY DOES NOT HAVE. A search box. `farmerFilterSchema` has
 * no free-text filter — no name, no phone, no farmer number — so a box here
 * could only search the page already downloaded. The filters below are exactly
 * the ones the route accepts; see lib/farmers/filters.ts, whose test asserts
 * that every query this screen can build is one the shared schema accepts.
 *
 * SCOPE. The server scopes the list to the caller. An administrator sees the
 * nation; a supervisor their state; an officer their caseload. The client never
 * re-scopes live rows — doing so would drop rows the reader is entitled to.
 */

const PAGE_SIZE = 25;

const SCOPE_BAND: Record<string, string> = {
  admin: 'National scope · all states',
  supervisor: 'State scope · your assigned state',
  read_only: 'State scope · read only',
  officer: 'Caseload scope · farmers you registered',
};

export function FarmersRegister() {
  const { role, hydrated } = usePreview();
  const { get, set } = useQueryState();
  const names = useLocationNames(hydrated);

  const filters = useMemo(() => fromQuery(get), [get]);
  const [draft, setDraft] = useState<RegisterFilters>(filters);
  const [rows, setRows] = useState<Farmer[]>([]);
  /** The cursor this page was fetched WITH; null is the first page. */
  const [cursor, setCursor] = useState<string | null>(null);
  /** The cursor the server handed back for the page AFTER this one. */
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  /** The cursors of the pages already visited, so Previous can walk back. */
  const [history, setHistory] = useState<Array<string | null>>([]);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(LIVE_FARMERS);
  const [error, setError] = useState<string | undefined>();
  const [attempt, setAttempt] = useState(0);
  /**
   * Ticked rows, scoped to the page in front of the reader.
   *
   * Cursor paging means the client holds one page and a cursor, never the
   * register. A tick on page one therefore says nothing about page four, which
   * was never loaded. Rather than keep a set that silently spans pages nobody
   * saw, it is pruned to the rows actually on screen whenever they change, and
   * every label ends in "on this page".
   */
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());

  // The URL is the source of truth for applied filters, so the form follows it
  // when the reader arrives on a shared link or presses Back from a dossier.
  useEffect(() => {
    setDraft(filters);
  }, [filters]);

  const applied = useMemo(() => toListParams(filters, cursor ?? undefined), [filters, cursor]);
  const appliedKey = JSON.stringify(applied);

  useEffect(() => {
    if (!LIVE_FARMERS || !hydrated) return;
    let live = true;
    setLoading(true);
    listFarmers({ ...(JSON.parse(appliedKey) as object), limit: PAGE_SIZE })
      .then((result) => {
        if (!live) return;
        setRows(result.farmers);
        setNextCursor(result.cursor);
        setHasMore(result.hasMore);
        setError(undefined);
      })
      .catch(() => live && setError('Could not load this information.'))
      .finally(() => live && setLoading(false));
    return () => {
      live = false;
    };
  }, [appliedKey, hydrated, attempt]);

  /** Off live, the same filters applied to the fixture register, clearly labelled. */
  const previewRows = useMemo(() => {
    if (LIVE_FARMERS) return [];
    let pool = scopeFarmers(FARMERS, role);
    if (filters.status) pool = pool.filter((f) => f.verification_status === filters.status);
    if (filters.payam) pool = pool.filter((f) => f.payam_id === filters.payam);
    if (filters.county) pool = pool.filter((f) => f.payam_id.startsWith(`${filters.county}-`));
    if (filters.state) pool = pool.filter((f) => f.state_id === filters.state);
    if (filters.sex) pool = pool.filter((f) => f.sex === filters.sex);
    if (filters.registered_from) pool = pool.filter((f) => f.created_at >= filters.registered_from);
    if (filters.registered_to)
      pool = pool.filter((f) => f.created_at <= `${filters.registered_to}T23:59:59.999Z`);
    return pool;
  }, [filters, role]);

  const shown = LIVE_FARMERS ? rows : previewRows;
  const pageIds = useMemo(() => shown.map((f) => f.id), [shown]);
  const pageKey = pageIds.join(',');

  useEffect(() => {
    // A new page, a new filter or a new sort order: drop ticks for rows that
    // are no longer in front of the reader rather than carry them invisibly.
    setSelected((was) => {
      const pruned = prunedSelection(was, pageKey ? pageKey.split(',') : []);
      return pruned.size === was.size ? was : pruned;
    });
  }, [pageKey]);

  const selectable = hydrated && canSelect(role);
  const selectedHere = [...selected].filter((id) => pageIds.includes(id)).length;
  const allOnPageSelected = pageIds.length > 0 && pageIds.every((id) => selected.has(id));
  const chips = activeChips(filters, { county: names.county, payam: names.payam });
  const printCtx = printContext(filters, {
    county: names.county,
    payam: names.payam,
    state: names.state,
  });
  /** Resolved at render so the sheet carries the moment it was produced. */
  const printedAt = new Date().toLocaleString('en-GB', {
    dateStyle: 'long',
    timeStyle: 'short',
  });

  const apply = useCallback(() => {
    // A cursor belongs to the query that produced it, so a new query starts
    // again from the first page rather than resuming somebody else's page 3.
    setCursor(null);
    setHistory([]);
    set({ ...draft });
  }, [draft, set]);

  const clearAll = useCallback(() => {
    setCursor(null);
    setHistory([]);
    setDraft(EMPTY_FILTERS);
    set(clearPatch());
  }, [set]);

  const removeChip = useCallback(
    (key: keyof RegisterFilters) => {
      setCursor(null);
      setHistory([]);
      set({ [key]: null });
    },
    [set],
  );

  /**
   * Forward by the cursor the server handed back with this page.
   *
   * The route answers `{ cursor, hasMore }` and never a page count, so there is
   * no "page 4 of 19" to offer and no way to jump. Previous is possible only
   * because the cursor of every page visited is kept here — the server is
   * never asked to walk backwards, because it cannot.
   */
  const nextPage = useCallback(() => {
    if (!nextCursor) return;
    setHistory((past) => [...past, cursor]);
    setCursor(nextCursor);
  }, [cursor, nextCursor]);

  const previousPage = useCallback(() => {
    setHistory((past) => {
      if (past.length === 0) return past;
      setCursor(past[past.length - 1] ?? null);
      return past.slice(0, -1);
    });
  }, []);

  if (!hydrated) return null;

  const county = (f: Farmer) => f.payam_id.split('-').slice(0, 2).join('-');
  const placeOf = (f: Farmer) =>
    [names.state(f.state_id) ?? f.state_id, names.county(county(f)), names.payam(f.payam_id)]
      .filter(Boolean)
      .join(' › ');

  return (
    <div className={styles.registerStack}>
      <PageHeader
        eyebrow="Field operations"
        title="Farmers"
        subtitle="National farmer register."
        actions={
          <>
            <Button variant="ghost" onClick={() => window.print()}>
              <IconPrint size={16} /> Print this view
            </Button>
            {canRegister(role) ? (
              <ButtonLink href="/farmers/new" variant="primary">
                <IconPlus size={16} /> Register a farmer
              </ButtonLink>
            ) : null}
          </>
        }
      />

      {/*
       * THE PRINTED SHEET'S OWN HEADER.
       *
       * Invisible on screen, and the only thing on paper that says what this
       * page is. A register printed without the query that produced it is a
       * column of names nobody can check a week later — and the route pages by
       * cursor, so the sheet must also say it is one page of a longer list
       * rather than imply it is the whole register.
       *
       * Everything here describes the QUERY. None of it can carry personal
       * data, because none of the filters are personal: there is no name,
       * phone or national-ID filter to echo.
       */}
      <div className="print-only">
        <p>{SCOPE_BAND[role] ?? 'Scope'}</p>
        <p>{printCtx.lines.join(' · ')}</p>
        <p>{printRowNote(shown.length, hasMore)}</p>
        <p>Printed {printedAt}</p>
        {LIVE_FARMERS ? null : <p>Preview data — not the live register.</p>}
      </div>

      <div className={`${styles.scopeBand} no-print`}>
        <span>{SCOPE_BAND[role] ?? 'Scope'}</span>
        <span className={styles.scopeBandNote}>
          {LIVE_FARMERS ? null : 'Preview data — no live register on this deployment.'}
        </span>
      </div>

      {/* ---- Tabs: only statuses the route can answer ------------------ */}
      <div
        className={`${styles.tabs} no-print`}
        role="tablist"
        aria-label="Filter by verification status"
      >
        {STATUS_TABS.map((tab) => {
          const active = filters.status === tab.key;
          return (
            <button
              key={tab.key || 'all'}
              type="button"
              role="tab"
              aria-selected={active}
              className={`${styles.tab} ${active ? styles.tabActive : ''}`}
              onClick={() => {
                setCursor(null);
                setHistory([]);
                set({ status: tab.key || null });
              }}
            >
              {tab.label}
            </button>
          );
        })}
      </div>

      {/* ---- Filters ---------------------------------------------------- */}
      <div className={`${styles.filterBarWrap} no-print`}>
        <div className={styles.filterGrid}>
          <Field label="State" hint="Narrows the lists below">
            {(ids) => (
              <Select
                {...ids}
                value={draft.state}
                onChange={(e) =>
                  setDraft({ ...draft, state: e.target.value, county: '', payam: '' })
                }
              >
                <option value="">Any state</option>
                {names.states.map((row) => (
                  <option key={row.id} value={row.id}>
                    {row.name}
                  </option>
                ))}
              </Select>
            )}
          </Field>

          <Field label="County">
            {(ids) => (
              <Select
                {...ids}
                value={draft.county}
                onChange={(e) => setDraft({ ...draft, county: e.target.value, payam: '' })}
              >
                <option value="">Any county</option>
                {names.countiesIn(draft.state).map((row) => (
                  <option key={row.id} value={row.id}>
                    {row.name}
                  </option>
                ))}
              </Select>
            )}
          </Field>

          <Field label="Payam">
            {(ids) => (
              <Select
                {...ids}
                value={draft.payam}
                onChange={(e) => setDraft({ ...draft, payam: e.target.value })}
              >
                <option value="">Any payam</option>
                {names.payamsIn(draft.state, draft.county).map((row) => (
                  <option key={row.id} value={row.id}>
                    {row.name}
                  </option>
                ))}
              </Select>
            )}
          </Field>

          <Field label="Sex">
            {(ids) => (
              <Select
                {...ids}
                value={draft.sex}
                onChange={(e) => setDraft({ ...draft, sex: e.target.value })}
              >
                <option value="">Any</option>
                <option value="f">Female</option>
                <option value="m">Male</option>
              </Select>
            )}
          </Field>

          <Field label="Possible duplicates">
            {(ids) => (
              <Select
                {...ids}
                value={draft.duplicate}
                onChange={(e) => setDraft({ ...draft, duplicate: e.target.value })}
              >
                <option value="">Any</option>
                <option value="true">Flagged only</option>
                <option value="false">Not flagged</option>
              </Select>
            )}
          </Field>
        </div>

        <div className={`${styles.filterGrid} ${styles.filterAdvanced}`}>
          <Field label="Registered from">
            {(ids) => (
              <Input
                {...ids}
                type="date"
                value={draft.registered_from}
                max={draft.registered_to || undefined}
                onChange={(e) => setDraft({ ...draft, registered_from: e.target.value })}
              />
            )}
          </Field>
          <Field label="Registered to">
            {(ids) => (
              <Input
                {...ids}
                type="date"
                value={draft.registered_to}
                min={draft.registered_from || undefined}
                onChange={(e) => setDraft({ ...draft, registered_to: e.target.value })}
              />
            )}
          </Field>
          <Field label="Changed since" hint="Records edited on or after this date">
            {(ids) => (
              <Input
                {...ids}
                type="date"
                value={draft.updated_since}
                onChange={(e) => setDraft({ ...draft, updated_since: e.target.value })}
              />
            )}
          </Field>
        </div>

        <div className={styles.filterFoot}>
          <Button onClick={apply}>Apply filters</Button>
          <Button variant="secondary" onClick={clearAll}>
            Clear filters
          </Button>
          {draft.state && !draft.county && !draft.payam ? (
            <p className={styles.filterHint}>
              A state narrows the county and payam lists; choose one of those to filter the register
              by place.
            </p>
          ) : null}
        </div>
      </div>

      {chips.length > 0 ? (
        <div className={`${styles.chips} no-print`}>
          {chips.map((chip) => (
            <span key={chip.key} className={styles.chip}>
              {chip.label}
              <button
                type="button"
                className={styles.chipRemove}
                onClick={() => removeChip(chip.key)}
                aria-label={`Remove filter ${chip.label}`}
              >
                <IconX size={13} />
              </button>
            </span>
          ))}
          <Button variant="ghost" size="small" onClick={clearAll}>
            Clear all
          </Button>
        </div>
      ) : null}

      {/*
       * THE SELECTION BAR.
       *
       * It offers exactly one action, and that action is a link. NO ROUTE IN
       * THIS SYSTEM TAKES A LIST OF FARMER IDS — there is no bulk verify, no
       * bulk reject, no bulk reassign, no bulk remove — so ticking rows marks
       * the ones a reviewer is working through and nothing more. Decisions are
       * taken one at a time in the queue, each with its own reason recorded in
       * its own audit row, which is what C-6 requires and what a bulk button
       * would quietly undo.
       */}
      {selectable && selectedHere > 0 ? (
        <div className={`${styles.bulkBar} no-print`} role="status">
          <span className={styles.bulkCount}>{selectionLabel(selectedHere)}</span>
          <span className={styles.bulkNote}>
            Selecting marks rows for your own reading. Verification decisions are taken one at a
            time, with a reason.
          </span>
          <ButtonLink href="/farmers/review" variant="secondary" size="small">
            Open the verification queue
          </ButtonLink>
          <Button variant="ghost" size="small" onClick={() => setSelected(new Set())}>
            Clear selection
          </Button>
        </div>
      ) : null}

      {/* ---- The register ----------------------------------------------- */}
      {error ? (
        <Notice kind="error" title="Could not load this information">
          <p className="small">
            The register could not be read just now.{' '}
            <Button variant="ghost" size="small" onClick={() => setAttempt((n) => n + 1)}>
              Try again
            </Button>
          </p>
        </Notice>
      ) : loading ? (
        <div className={styles.skelTable} role="status" aria-live="polite">
          <span className="visually-hidden">Loading the register</span>
          {Array.from({ length: 8 }, (_, index) => (
            <div key={index} className={styles.skelRow}>
              <span className={styles.skelCell} />
              <span className={styles.skelCell} />
              <span className={styles.skelCell} />
              <span className={styles.skelCell} />
              <span className={styles.skelCell} />
            </div>
          ))}
        </div>
      ) : (
        <>
          <DataTable
            caption={`Farmers in the register — ${statusLabel(filters.status)}`}
            rows={shown}
            rowKey={(f) => f.id}
            empty={
              <Notice
                kind="info"
                title={
                  hasActiveFilters(filters) ? 'No farmers match these filters' : 'No farmers found'
                }
              >
                <p className="small">
                  {hasActiveFilters(filters) ? (
                    <>
                      Nothing in the register matches this combination.{' '}
                      <Button variant="ghost" size="small" onClick={clearAll}>
                        Clear filters
                      </Button>
                    </>
                  ) : (
                    'No farmers have been registered in your scope yet.'
                  )}
                </p>
              </Notice>
            }
            columns={[
              ...(selectable
                ? [
                    {
                      key: 'select',
                      // Hidden on paper: an empty tick box on a printed sheet
                      // reads as a form somebody is meant to fill in by hand.
                      printHidden: true,
                      nowrap: true,
                      header: 'Select',
                      // Select-all reaches this page and no further: the rows
                      // beyond the cursor have not been loaded and may not
                      // even have been computed.
                      headerNode: (
                        <Checkbox
                          label="Select every farmer on this page"
                          labelHidden
                          checked={allOnPageSelected}
                          onChange={() => setSelected((was) => toggleAllOnPage(was, pageIds))}
                        />
                      ),
                      render: (f: Farmer) => (
                        <Checkbox
                          label={`Select ${f.given_name} ${f.family_name}`}
                          labelHidden
                          checked={selected.has(f.id)}
                          onChange={() => setSelected((was) => toggleSelection(was, f.id))}
                        />
                      ),
                    },
                  ]
                : []),
              {
                key: 'farmer',
                header: 'Farmer',
                rowHeader: true,
                render: (f) => (
                  <>
                    <Link href={`/farmers/${f.id}`} dir="auto">
                      {f.given_name} {f.family_name}
                    </Link>
                    <span className={styles.recordNumberCell}>{f.farmer_number}</span>
                  </>
                ),
              },
              {
                key: 'phone',
                header: 'Phone',
                nowrap: true,
                render: (f) => <span className="mono">{formatPhone(f.phone)}</span>,
              },
              { key: 'place', header: 'Location', render: (f) => placeOf(f) },
              {
                key: 'sex',
                header: 'Sex',
                nowrap: true,
                render: (f) => (f.sex === 'f' ? 'Female' : 'Male'),
              },
              {
                key: 'registered',
                header: 'Registered',
                nowrap: true,
                render: (f) => formatDate(f.created_at),
              },
              {
                key: 'officer',
                header: 'Officer',
                nowrap: true,
                render: (f) =>
                  officerById(f.caseload_officer_id ?? '')?.name ?? (
                    <span className="muted">Not shown</span>
                  ),
              },
              {
                key: 'status',
                header: 'Status',
                render: (f) => (
                  <>
                    <Stamp kind={statusStamp(f)}>{STATUS_LABEL[effectiveStatus(f)]}</Stamp>
                    {f.duplicate_flag ? (
                      <span className={styles.dupFlag}>
                        <IconWarn size={12} /> Possible duplicate
                      </span>
                    ) : null}
                  </>
                ),
              },
            ]}
          />

          {LIVE_FARMERS ? (
            <div className="no-print">
              <Pagination
                shown={shown.length}
                hasMore={hasMore}
                onNext={nextPage}
                onPrevious={previousPage}
                canGoBack={history.length > 0}
                busy={loading}
              />
            </div>
          ) : null}
        </>
      )}
    </div>
  );
}
