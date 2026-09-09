'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';

import { LIVE_FARMERS, listFarmers } from '@/lib/farmers/api';
import { CROP_LABELS, formatPhone, pluralise } from '@/lib/format';
import {
  canRegister,
  canReview,
  daysWaiting,
  duplicatesOf,
  effectiveStatus,
  isEscalated,
  scopeFarmers,
  statusStamp,
  syncStatusOf,
  STATUS_LABEL,
} from '@/lib/farmers/presentation';
import {
  COOPERATIVES,
  FARMERS,
  OFFICERS,
  STATE_NAMES,
  cropsForFarmer,
  farmerPayamName,
  farmsForFarmer,
  membershipsForFarmer,
  officerById,
  syncForEntity,
  totalAreaHa,
  type Farmer,
} from '@/lib/fixtures/farmers';
import { CROPS, type Crop } from '@agri-erp/shared';
import { usePreview } from '@/lib/preview';
import { useQueryState } from '@/lib/query-state';

import {
  Button,
  ButtonLink,
  Checkbox,
  Dialog,
  EmptyState,
  KpiStrip,
  Notice,
  PageHeader,
  SearchInput,
  Select,
  Stamp,
  SyncChip,
} from '../ui';
import { IconPlus, IconPrint } from '../ui/icons';
import screens from '../screens.module.css';
import styles from './farmers.module.css';

/** The preview's fixed "today", so ages and waits match the fixture clock. */
const TODAY_YEAR = 2026;

type SortKey = 'number' | 'name' | 'payam' | 'age' | 'farms' | 'area' | 'wait' | 'status';

const STATUS_ORDER: Record<string, number> = { pending: 0, verified: 1, rejected: 2, merged: 3 };

const AGE_BANDS: ReadonlyArray<{ key: string; label: string; test: (age: number) => boolean }> = [
  { key: 'u25', label: 'Under 25', test: (a) => a < 25 },
  { key: '25-34', label: '25–34', test: (a) => a >= 25 && a < 35 },
  { key: '35-44', label: '35–44', test: (a) => a >= 35 && a < 45 },
  { key: '45-59', label: '45–59', test: (a) => a >= 45 && a < 60 },
  { key: '60', label: '60 and over', test: (a) => a >= 60 },
];

function ageOf(f: Farmer): number {
  return TODAY_YEAR - f.year_of_birth;
}

export function FarmersRegister() {
  const { role, hydrated } = usePreview();
  const { get, set } = useQueryState();
  const [sort, setSort] = useState<{ key: SortKey; dir: 'asc' | 'desc' }>({
    key: 'wait',
    dir: 'desc',
  });
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [exportOpen, setExportOpen] = useState(false);

  const showChecks = hydrated && canReview(role);

  // The pool is the fixtures until NEXT_PUBLIC_USE_LIVE_FARMERS is set, then the
  // live B5 list. Crops, farms and cooperative membership still come from the
  // fixtures below (their backend is B7 / cooperatives), so those columns and
  // filters are inert on live data until those units land.
  const [livePool, setLivePool] = useState<Farmer[] | null>(null);
  const [loadError, setLoadError] = useState<string | undefined>();

  useEffect(() => {
    if (!LIVE_FARMERS) return;
    let live = true;
    listFarmers({ limit: 200 })
      .then((r) => live && (setLivePool(r.farmers), setLoadError(undefined)))
      .catch(
        (e) => live && setLoadError(e instanceof Error ? e.message : 'Could not load farmers.'),
      );
    return () => {
      live = false;
    };
  }, []);

  const pool = LIVE_FARMERS ? (livePool ?? []) : FARMERS;

  // Everything a non-admin may not see is removed before any filter runs.
  const scoped = useMemo(() => scopeFarmers(pool, role), [pool, role]);

  const q = get('q').trim().toLowerCase();
  const fState = get('state');
  const fPayam = get('payam');
  const fStatus = get('status');
  const fSex = get('sex');
  const fAge = get('age');
  const fSource = get('source');
  const fOfficer = get('officer');
  const fCrop = get('crop');
  const fDup = get('dup');
  const fCoop = get('coop');

  const rows = useMemo(() => {
    const dupIds = new Set(scoped.filter((f) => duplicatesOf(f, pool).length > 0).map((f) => f.id));
    return scoped.filter((f) => {
      if (q) {
        const hay = `${f.given_name} ${f.family_name} ${f.phone} ${f.farmer_number}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      if (fState && f.state_id !== fState) return false;
      if (fPayam && f.payam_id !== fPayam) return false;
      if (fStatus && effectiveStatus(f) !== fStatus) return false;
      if (fSex && f.sex !== fSex) return false;
      if (fAge) {
        const band = AGE_BANDS.find((b) => b.key === fAge);
        if (band && !band.test(ageOf(f))) return false;
      }
      if (fSource && f.registration_source !== fSource) return false;
      if (fOfficer && f.registered_by !== fOfficer) return false;
      if (fCrop && !cropsForFarmer(f.id).includes(fCrop as Crop)) return false;
      if (fDup === '1' && !dupIds.has(f.id)) return false;
      if (fCoop && !membershipsForFarmer(f.id).some((m) => m.cooperative_id === fCoop))
        return false;
      return true;
    });
  }, [pool, scoped, q, fState, fPayam, fStatus, fSex, fAge, fSource, fOfficer, fCrop, fDup, fCoop]);

  const sorted = useMemo(() => {
    const dir = sort.dir === 'asc' ? 1 : -1;
    const value = (f: Farmer): number | string => {
      switch (sort.key) {
        case 'number':
          return f.farmer_number;
        case 'name':
          return `${f.family_name} ${f.given_name}`.toLowerCase();
        case 'payam':
          return farmerPayamName(f.payam_id).toLowerCase();
        case 'age':
          return ageOf(f);
        case 'farms':
          return farmsForFarmer(f.id).length;
        case 'area':
          return totalAreaHa(f.id);
        case 'wait':
          return daysWaiting(f);
        case 'status':
          return STATUS_ORDER[effectiveStatus(f)] ?? 9;
      }
    };
    return [...rows].sort((a, b) => {
      const va = value(a);
      const vb = value(b);
      if (va < vb) return -1 * dir;
      if (va > vb) return 1 * dir;
      return a.farmer_number.localeCompare(b.farmer_number);
    });
  }, [rows, sort]);

  const kpis = useMemo(() => {
    let verified = 0;
    let pending = 0;
    let escalated = 0;
    let rejected = 0;
    let merged = 0;
    for (const f of scoped) {
      const s = effectiveStatus(f);
      if (s === 'verified') verified += 1;
      else if (s === 'pending') {
        pending += 1;
        if (isEscalated(f)) escalated += 1;
      } else if (s === 'rejected') rejected += 1;
      else if (s === 'merged') merged += 1;
    }
    return { registered: scoped.length, verified, pending, escalated, rejected, merged };
  }, [scoped]);

  function toggleSort(key: SortKey) {
    setSort((prev) =>
      prev.key === key
        ? { key, dir: prev.dir === 'asc' ? 'desc' : 'asc' }
        : { key, dir: key === 'name' || key === 'payam' || key === 'number' ? 'asc' : 'desc' },
    );
  }

  function toggleSelect(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  const selectablePending = sorted.filter((f) => effectiveStatus(f) === 'pending');
  const allPendingSelected =
    selectablePending.length > 0 && selectablePending.every((f) => selected.has(f.id));

  const activeFilters =
    q ||
    fState ||
    fPayam ||
    fStatus ||
    fSex ||
    fAge ||
    fSource ||
    fOfficer ||
    fCrop ||
    fDup ||
    fCoop;

  const scopeName = role === 'admin' ? 'All states' : (STATE_NAMES.CE ?? 'Central Equatoria');

  function reset() {
    set({
      q: null,
      state: null,
      payam: null,
      status: null,
      sex: null,
      age: null,
      source: null,
      officer: null,
      crop: null,
      dup: null,
      coop: null,
    });
  }

  const officersInScope = OFFICERS.filter((o) => role === 'admin' || o.status === 'active');

  return (
    <>
      <PageHeader
        eyebrow={`Farmers · ${scopeName}`}
        title="The farmers register"
        subtitle="Every lead farmer on the programme, their fields and their crops. Search by name, phone or number; the register reads across."
        actions={
          <>
            <Button variant="ghost" onClick={() => window.print()}>
              <IconPrint size={18} />
              Print
            </Button>
            <Button variant="secondary" onClick={() => setExportOpen(true)}>
              Export…
            </Button>
            {hydrated && canRegister(role) ? (
              <ButtonLink href="/farmers/new">
                <IconPlus size={18} />
                Register farmer
              </ButtonLink>
            ) : null}
          </>
        }
      />

      <div style={{ marginBottom: 'var(--s-6)' }}>
        <KpiStrip
          label="Register totals"
          items={[
            { label: 'Registered', value: kpis.registered },
            { label: 'Verified', value: kpis.verified },
            { label: 'Pending', value: kpis.pending, accent: kpis.pending > 0 },
            { label: 'Escalated', value: kpis.escalated, accent: kpis.escalated > 0 },
            { label: 'Rejected', value: kpis.rejected },
            { label: 'Merged', value: kpis.merged },
          ]}
        />
      </div>

      <div className={styles.register}>
        <aside className={`${styles.rail} no-print`} aria-label="Filter the register">
          <div className={styles.railGroup}>
            <div className={styles.railHead}>
              <span className="label">Search</span>
              {activeFilters ? (
                <button type="button" className={styles.railReset} onClick={reset}>
                  Clear all
                </button>
              ) : null}
            </div>
            <SearchInput
              label="Search farmers"
              placeholder="Name, phone or number"
              value={get('q')}
              onChange={(e) => set({ q: e.target.value })}
            />
          </div>

          <RailSelect
            label="State"
            value={fState}
            onChange={(v) => set({ state: v, payam: null })}
            disabled={role !== 'admin'}
            hidden={role !== 'admin'}
            options={Object.entries(STATE_NAMES).map(([id, name]) => ({ value: id, label: name }))}
            allLabel="All states"
          />

          <RailSelect
            label="Payam"
            value={fPayam}
            onChange={(v) => set({ payam: v })}
            options={payamOptions(scoped)}
            allLabel="All payams"
          />

          <RailSelect
            label="Verification"
            value={fStatus}
            onChange={(v) => set({ status: v })}
            options={[
              { value: 'pending', label: 'Pending' },
              { value: 'verified', label: 'Verified' },
              { value: 'rejected', label: 'Rejected' },
              { value: 'merged', label: 'Merged' },
            ]}
            allLabel="Any status"
          />

          <RailSelect
            label="Sex"
            value={fSex}
            onChange={(v) => set({ sex: v })}
            options={[
              { value: 'f', label: 'Female' },
              { value: 'm', label: 'Male' },
            ]}
            allLabel="Any"
          />

          <RailSelect
            label="Age band"
            value={fAge}
            onChange={(v) => set({ age: v })}
            options={AGE_BANDS.map((b) => ({ value: b.key, label: b.label }))}
            allLabel="Any age"
          />

          <RailSelect
            label="Registration source"
            value={fSource}
            onChange={(v) => set({ source: v })}
            options={[
              { value: 'officer', label: 'Officer' },
              { value: 'self', label: 'Self' },
            ]}
            allLabel="Either"
          />

          <RailSelect
            label="Officer"
            value={fOfficer}
            onChange={(v) => set({ officer: v })}
            options={officersInScope.map((o) => ({ value: o.id, label: o.name }))}
            allLabel="Any officer"
          />

          <RailSelect
            label="Crop"
            value={fCrop}
            onChange={(v) => set({ crop: v })}
            options={CROPS.map((c) => ({ value: c, label: CROP_LABELS[c] }))}
            allLabel="Any crop"
          />

          <RailSelect
            label="Cooperative"
            value={fCoop}
            onChange={(v) => set({ coop: v })}
            options={COOPERATIVES.map((c) => ({ value: c.id, label: c.name }))}
            allLabel="Any / none"
          />

          <div className={styles.railGroup}>
            <span className="label">Duplicates</span>
            <Checkbox
              label="Only possible duplicates"
              checked={fDup === '1'}
              onChange={(e) => set({ dup: e.target.checked ? '1' : null })}
            />
          </div>
        </aside>

        <div className={styles.content}>
          {showChecks && selected.size > 0 ? (
            <div className={`${styles.bulkBar} no-print`}>
              <span className={styles.bulkCount}>{selected.size} selected</span>
              <ButtonLink href="/farmers/review" variant="primary" size="small">
                Review selected
              </ButtonLink>
              <Button variant="ghost" size="small" onClick={() => setSelected(new Set())}>
                Clear
              </Button>
            </div>
          ) : null}

          {loadError ? (
            <Notice kind="error">
              <p className="small">{loadError}</p>
            </Notice>
          ) : null}

          <p className={screens.resultLine} aria-live="polite">
            Showing {pluralise(sorted.length, 'farmer')} of {scoped.length} in scope
            {activeFilters ? ' · filtered' : ''}
          </p>

          {sorted.length === 0 ? (
            <EmptyState
              title={activeFilters ? 'No farmers match these filters' : 'No farmers in scope'}
              body={
                activeFilters
                  ? 'Loosen a filter, clear the search, or check the payam and status you chose.'
                  : 'Nothing is registered for this role yet. An officer registers farmers from the field.'
              }
              actions={
                activeFilters ? (
                  <Button variant="secondary" onClick={reset}>
                    Clear filters
                  </Button>
                ) : hydrated && canRegister(role) ? (
                  <ButtonLink href="/farmers/new">Register a farmer</ButtonLink>
                ) : null
              }
            />
          ) : (
            <div className={styles.tableScroll}>
              <table className={`${screens.table} ${styles.registerTable}`}>
                <thead>
                  <tr>
                    {showChecks ? (
                      <th className={styles.thCheck} scope="col">
                        <input
                          type="checkbox"
                          aria-label="Select all pending"
                          checked={allPendingSelected}
                          onChange={(e) =>
                            setSelected(
                              e.target.checked
                                ? new Set(selectablePending.map((f) => f.id))
                                : new Set(),
                            )
                          }
                        />
                      </th>
                    ) : null}
                    <SortTh label="Farmer no" k="number" sort={sort} onSort={toggleSort} />
                    <SortTh label="Name" k="name" sort={sort} onSort={toggleSort} />
                    <th scope="col">Sex / age</th>
                    <SortTh label="Payam" k="payam" sort={sort} onSort={toggleSort} />
                    <th scope="col">Phone</th>
                    <th scope="col">Crops</th>
                    <SortTh label="Farms" k="farms" sort={sort} onSort={toggleSort} num />
                    <th scope="col">Officer</th>
                    <SortTh label="Status" k="status" sort={sort} onSort={toggleSort} />
                    <SortTh label="Wait" k="wait" sort={sort} onSort={toggleSort} num />
                    <th scope="col">Sync</th>
                  </tr>
                </thead>
                <tbody>
                  {sorted.map((f) => {
                    const farms = farmsForFarmer(f.id);
                    const crops = cropsForFarmer(f.id).map((c) => CROP_LABELS[c]);
                    const officer = officerById(f.registered_by);
                    const status = effectiveStatus(f);
                    const escalated = isEscalated(f);
                    const wait = daysWaiting(f);
                    return (
                      <tr key={f.id} aria-selected={selected.has(f.id) || undefined}>
                        {showChecks ? (
                          <td>
                            <input
                              type="checkbox"
                              aria-label={`Select ${f.given_name} ${f.family_name}`}
                              checked={selected.has(f.id)}
                              disabled={status !== 'pending'}
                              onChange={() => toggleSelect(f.id)}
                            />
                          </td>
                        ) : null}
                        <td className={screens.tdNowrap}>
                          <span className="mono small">{f.farmer_number}</span>
                        </td>
                        <td>
                          <span className={styles.cellName}>
                            <Link
                              href={`/farmers/${f.id}`}
                              className={styles.cellNameMain}
                              dir="auto"
                            >
                              {f.given_name} {f.family_name}
                            </Link>
                          </span>
                        </td>
                        <td className={screens.tdNowrap}>
                          <span className="small">
                            {f.sex === 'f' ? 'F' : 'M'} · <span className="mono">{ageOf(f)}</span>
                          </span>
                        </td>
                        <td className={screens.tdNowrap}>{farmerPayamName(f.payam_id)}</td>
                        <td className={`${screens.tdNowrap} mono small`}>{formatPhone(f.phone)}</td>
                        <td>
                          <span className={styles.cellCrops} title={crops.join(', ')}>
                            {crops.length ? crops.join(', ') : '—'}
                          </span>
                        </td>
                        <td className={screens.tdNum}>
                          {farms.length}
                          {farms.length ? (
                            <span className="muted"> · {totalAreaHa(f.id).toFixed(1)} ha</span>
                          ) : null}
                        </td>
                        <td className={screens.tdNowrap}>{officer ? officer.name : 'Self'}</td>
                        <td className={screens.tdNowrap}>
                          <span className={styles.stampInline}>
                            <Stamp kind={statusStamp(f)}>{STATUS_LABEL[status]}</Stamp>
                            {escalated ? <Stamp kind="escalated">Esc</Stamp> : null}
                          </span>
                        </td>
                        <td className={screens.tdNum}>
                          <span
                            className={`${styles.cellWait} ${escalated ? styles.cellWaitEscalated : ''}`}
                          >
                            {status === 'pending' ? `${wait}d` : '—'}
                          </span>
                        </td>
                        <td className={screens.tdNowrap}>
                          <SyncChip status={syncStatusOf(syncForEntity(f.id))} />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      <Dialog
        open={exportOpen}
        onClose={() => setExportOpen(false)}
        title="Export the register"
        footer={
          <>
            <Button variant="ghost" onClick={() => setExportOpen(false)}>
              Cancel
            </Button>
            <Button variant="primary" onClick={() => setExportOpen(false)}>
              Log this export
            </Button>
          </>
        }
      >
        <p>
          An export is a recorded act, not a quiet download. Under the reporting law every export
          writes an audit row: who ran it, the exact filters and search in force, and a cut-off date
          so the file can be reproduced.
        </p>
        <p className="small muted">
          This preview has no server, so nothing is written and no file is produced. The dialog is
          here to show the shape of the act: filters and cut-off captured, then logged.
        </p>
      </Dialog>
    </>
  );
}

/* ---- Small pieces ----------------------------------------------------- */

function SortTh({
  label,
  k,
  sort,
  onSort,
  num,
}: {
  label: string;
  k: SortKey;
  sort: { key: SortKey; dir: 'asc' | 'desc' };
  onSort: (k: SortKey) => void;
  num?: boolean;
}) {
  const active = sort.key === k;
  return (
    <th
      scope="col"
      style={num ? { textAlign: 'right' } : undefined}
      aria-sort={active ? (sort.dir === 'asc' ? 'ascending' : 'descending') : 'none'}
    >
      <button type="button" className={styles.sortBtn} onClick={() => onSort(k)}>
        {label}
        {active ? (
          <span className={styles.sortArrow} aria-hidden>
            {sort.dir === 'asc' ? '▲' : '▼'}
          </span>
        ) : null}
      </button>
    </th>
  );
}

function RailSelect({
  label,
  value,
  onChange,
  options,
  allLabel,
  disabled,
  hidden,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: ReadonlyArray<{ value: string; label: string }>;
  allLabel: string;
  disabled?: boolean;
  hidden?: boolean;
}) {
  if (hidden) return null;
  return (
    <div className={styles.railGroup}>
      <div className={styles.railField}>
        <span className="label">{label}</span>
        <Select
          value={value}
          disabled={disabled}
          aria-label={label}
          onChange={(e) => onChange(e.target.value)}
        >
          <option value="">{allLabel}</option>
          {options.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </Select>
      </div>
    </div>
  );
}

function payamOptions(pool: readonly Farmer[]): Array<{ value: string; label: string }> {
  const ids = [...new Set(pool.map((f) => f.payam_id))];
  return ids
    .map((id) => ({ value: id, label: farmerPayamName(id) }))
    .sort((a, b) => a.label.localeCompare(b.label));
}
