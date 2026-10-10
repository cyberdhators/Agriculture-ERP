'use client';

import { useEffect, useMemo, useState } from 'react';

import {
  COMMUNICATION_LIMITS,
  VERIFICATION_STATUSES,
  type CommunicationFarmer,
} from '@agri-erp/shared';

import {
  listPickerFarmers,
  selectAllPickerFarmers,
  type FarmerPickerFilter,
} from '@/lib/communications/api';
import { useLocationNames } from '@/lib/portal/locations';

import { Button, Checkbox, Field, Notice, SearchInput, Select } from '../ui';
import { LoadingState, Pagination, UnavailableState } from '../ui/data';
import styles from './comms.module.css';

/**
 * THE SMS FARMER PICKER.
 *
 * Built for many farmers, not a handful: a search over name, farmer number and
 * phone digits; filters by state, county, payam and verification status; a
 * page of results at a time; and "select all matching", which asks the server
 * for every reachable id under the current filter in one request.
 *
 * THE SELECTION OUTLIVES THE PAGE AND THE FILTER. Ticking farmers in Juba and
 * then filtering to Yei keeps the Juba farmers selected; the count above the
 * list is of everyone selected, and "Clear selection" is the only thing that
 * empties it.
 *
 * NO PHONE NUMBER REACHES THIS SCREEN. The route answers with ids, names and
 * places. A row that an SMS cannot reach — consent withdrawn, or no South
 * Sudan mobile on file — is shown and cannot be ticked, so nobody wonders
 * where a farmer went.
 */

const STATUS_LABEL: Record<string, string> = {
  pending: 'Pending',
  verified: 'Verified',
  rejected: 'Rejected',
};

const PAGE = 25;

export interface FarmerPickerProps {
  selected: ReadonlySet<string>;
  onChange: (next: ReadonlySet<string>) => void;
}

export function FarmerPicker({ selected, onChange }: FarmerPickerProps) {
  const places = useLocationNames(true);

  const [search, setSearch] = useState('');
  const [q, setQ] = useState('');
  const [state, setState] = useState('');
  const [county, setCounty] = useState('');
  const [payam, setPayam] = useState('');
  // Verified by default: a pending record may still turn out to be a
  // duplicate or not a farmer. The administrator can widen it on purpose.
  const [status, setStatus] = useState<string>('verified');

  const [rows, setRows] = useState<CommunicationFarmer[]>([]);
  const [total, setTotal] = useState(0);
  const [reachable, setReachable] = useState(0);
  const [cursor, setCursor] = useState<string | null>(null);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [back, setBack] = useState<Array<string | null>>([]);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | undefined>();
  const [selecting, setSelecting] = useState(false);
  const [notice, setNotice] = useState<string | undefined>();

  // The search waits for the typing to stop, so each keystroke is not a query.
  useEffect(() => {
    const timer = setTimeout(() => setQ(search.trim()), 300);
    return () => clearTimeout(timer);
  }, [search]);

  const filter: FarmerPickerFilter = useMemo(
    () => ({ q, state, county, payam, verification_status: status }),
    [q, state, county, payam, status],
  );

  // A new filter starts again at the first page.
  useEffect(() => {
    setCursor(null);
    setBack([]);
  }, [filter]);

  useEffect(() => {
    let live = true;
    setLoading(true);
    listPickerFarmers(filter, { cursor, limit: PAGE })
      .then((page) => {
        if (!live) return;
        setRows(page.rows);
        setTotal(page.total);
        setReachable(page.reachable);
        setNextCursor(page.cursor);
        setHasMore(page.hasMore);
        setError(undefined);
      })
      .catch((err: unknown) => {
        if (!live) return;
        setRows([]);
        setError(err instanceof Error ? err.message : 'Could not load the farmers.');
      })
      .finally(() => live && setLoading(false));
    return () => {
      live = false;
    };
  }, [filter, cursor]);

  const toggle = (id: string) => {
    const next = new Set(selected);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    onChange(next);
  };

  const pageReachable = rows.filter((r) => r.reachable);
  const pageAllSelected =
    pageReachable.length > 0 && pageReachable.every((r) => selected.has(r.id));

  const togglePage = () => {
    const next = new Set(selected);
    for (const r of pageReachable) {
      if (pageAllSelected) next.delete(r.id);
      else next.add(r.id);
    }
    onChange(next);
  };

  const selectAllMatching = async () => {
    setSelecting(true);
    setNotice(undefined);
    try {
      const answer = await selectAllPickerFarmers(filter);
      const next = new Set(selected);
      for (const id of answer.ids) next.add(id);
      onChange(next);
      setNotice(
        answer.capped
          ? `${answer.total} farmers match, more than one message may reach. The first ${answer.ids.length} were selected; narrow the filter and send the rest separately.`
          : `${answer.ids.length} matching ${answer.ids.length === 1 ? 'farmer' : 'farmers'} selected.`,
      );
    } catch (err) {
      setNotice(err instanceof Error ? err.message : 'Could not select the matching farmers.');
    } finally {
      setSelecting(false);
    }
  };

  const placeOf = (r: CommunicationFarmer) =>
    [places.payam(r.payam_id), places.state(r.state_id)].filter(Boolean).join(', ') || r.payam_id;

  return (
    <div className={styles.pickerBlock}>
      <div className={styles.filters}>
        <SearchInput
          label="Search farmers by name, farmer number or phone"
          placeholder="Name, farmer number or phone"
          value={search}
          maxLength={COMMUNICATION_LIMITS.searchMax}
          onChange={(e) => setSearch(e.target.value)}
        />
        <Field label="State">
          {(ids) => (
            <Select
              {...ids}
              value={state}
              onChange={(e) => {
                setState(e.target.value);
                setCounty('');
                setPayam('');
              }}
            >
              <option value="">All states</option>
              {places.states.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field label="County">
          {(ids) => (
            <Select
              {...ids}
              value={county}
              onChange={(e) => {
                setCounty(e.target.value);
                setPayam('');
              }}
            >
              <option value="">All counties</option>
              {places.countiesIn(state).map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field label="Payam">
          {(ids) => (
            <Select {...ids} value={payam} onChange={(e) => setPayam(e.target.value)}>
              <option value="">All payams</option>
              {places.payamsIn(state, county).map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field label="Verification">
          {(ids) => (
            <Select {...ids} value={status} onChange={(e) => setStatus(e.target.value)}>
              <option value="">Any status</option>
              {VERIFICATION_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {STATUS_LABEL[s] ?? s}
                </option>
              ))}
            </Select>
          )}
        </Field>
      </div>

      <div className={styles.selectedBar} aria-live="polite">
        <span>
          <strong>{selected.size}</strong> {selected.size === 1 ? 'farmer' : 'farmers'} selected
          {selected.size > COMMUNICATION_LIMITS.recipientsMax
            ? ` — one message reaches at most ${COMMUNICATION_LIMITS.recipientsMax}`
            : ''}
        </span>
        <span className={styles.counter}>
          {loading ? 'Counting…' : `${total} match · ${reachable} reachable by SMS`}
        </span>
        <Button
          variant="secondary"
          size="small"
          onClick={() => void selectAllMatching()}
          disabled={selecting || loading || reachable === 0}
        >
          {selecting ? 'Selecting…' : `Select all ${reachable} matching`}
        </Button>
        <Button
          variant="ghost"
          size="small"
          onClick={() => onChange(new Set())}
          disabled={selected.size === 0}
        >
          Clear selection
        </Button>
      </div>

      {notice ? <p className={styles.counter}>{notice}</p> : null}

      {error ? (
        <UnavailableState title="Farmers unavailable">{error}</UnavailableState>
      ) : loading ? (
        <LoadingState rows={4} label="Loading farmers" />
      ) : rows.length === 0 ? (
        <Notice kind="info" title="No farmers match">
          <p className="small">Change the search or the filters.</p>
        </Notice>
      ) : (
        <>
          <div className={styles.picker}>
            <div className={styles.pickerRow}>
              <Checkbox
                label="Select every reachable farmer on this page"
                checked={pageAllSelected}
                disabled={pageReachable.length === 0}
                onChange={togglePage}
              />
            </div>
            {rows.map((r) => (
              <div key={r.id} className={styles.pickerRow}>
                <Checkbox
                  label={`Select ${r.name}`}
                  labelHidden
                  checked={selected.has(r.id)}
                  disabled={!r.reachable && !selected.has(r.id)}
                  onChange={() => toggle(r.id)}
                />
                <span className={styles.pickerName} dir="auto">
                  {r.name}
                </span>
                <span className={styles.pickerMeta}>
                  {r.farmer_number} · {placeOf(r)} ·{' '}
                  {STATUS_LABEL[r.verification_status] ?? r.verification_status}
                  {r.reachable ? '' : ' · cannot receive SMS'}
                </span>
              </div>
            ))}
          </div>
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
