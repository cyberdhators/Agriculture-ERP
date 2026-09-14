'use client';

import { useEffect, useMemo, useState } from 'react';

import { Button, EmptyState, KpiStrip, Notice } from '@/components/ui';
import { IconImage, IconPlus } from '@/components/ui/icons';
import { usePreview } from '@/lib/preview';
import { listVisits, LIVE_VISITS, type Visit } from '@/lib/visits/api';
import { VISITS_FIXTURE, VISIT_TOPIC_LABELS } from '@/lib/visits/fixtures';
import { useVisitNames } from '@/lib/visits/names';

import { RecordVisitForm } from './RecordVisitForm';
import { VisitDetail } from './VisitDetail';
import styles from './visits.module.css';

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });
}
function fmtTime(iso: string): string {
  return new Date(iso).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
}

/**
 * The extension visit log (deliverable (d), C-8): recent visits across the
 * caller's caseload, newest received first, with the farmer, the officer, both
 * moments, the topics and a line of what was advised, and how many attachments
 * came with it. Filter by farmer or payam; open any row for the full record and
 * its attachments; an officer records a new visit from here. Reads the live B8
 * list when `NEXT_PUBLIC_USE_LIVE_VISITS=1`, sample visits otherwise so the log
 * can be walked before an officer is signed in.
 */
export function VisitsLog() {
  const { role, hydrated } = usePreview();
  const names = useVisitNames();
  const { farmer: farmerName, officer: officerName, payam: payamName } = names;
  const [visits, setVisits] = useState<readonly Visit[]>(LIVE_VISITS ? [] : VISITS_FIXTURE);
  const [loading, setLoading] = useState(LIVE_VISITS);
  const [error, setError] = useState<string | undefined>();
  const [cursor, setCursor] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);

  const [farmer, setFarmer] = useState('');
  const [payam, setPayam] = useState('');
  const [detail, setDetail] = useState<Visit | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [recorded, setRecorded] = useState<string | undefined>();

  useEffect(() => {
    if (!LIVE_VISITS) return;
    let live = true;
    setLoading(true);
    listVisits()
      .then((page) => {
        if (!live) return;
        setVisits(page.visits);
        setCursor(page.hasMore ? page.cursor : null);
        setError(undefined);
      })
      .catch((err: unknown) => {
        if (live) setError(err instanceof Error ? err.message : 'Could not load visits.');
      })
      .finally(() => live && setLoading(false));
    return () => {
      live = false;
    };
  }, []);

  async function loadMore() {
    if (!cursor) return;
    setLoadingMore(true);
    try {
      const page = await listVisits({ cursor });
      setVisits((list) => [...list, ...page.visits]);
      setCursor(page.hasMore ? page.cursor : null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load more visits.');
    } finally {
      setLoadingMore(false);
    }
  }

  const farmerOptions = useMemo(() => {
    const seen = new Map<string, string>();
    for (const v of visits)
      if (!seen.has(v.farmer_id)) seen.set(v.farmer_id, farmerName(v.farmer_id));
    return [...seen.entries()].sort((a, b) => a[1].localeCompare(b[1]));
  }, [visits]);

  const payamOptions = useMemo(() => {
    const seen = new Map<string, string>();
    for (const v of visits) if (!seen.has(v.payam_id)) seen.set(v.payam_id, payamName(v.payam_id));
    return [...seen.entries()].sort((a, b) => a[1].localeCompare(b[1]));
  }, [visits]);

  const shown = useMemo(
    () =>
      visits.filter((v) => (!farmer || v.farmer_id === farmer) && (!payam || v.payam_id === payam)),
    [visits, farmer, payam],
  );

  const kpis = useMemo(
    () => [
      { label: 'Visits', value: shown.length },
      { label: 'Farmers reached', value: new Set(shown.map((v) => v.farmer_id)).size },
      { label: 'Follow-ups', value: shown.filter((v) => v.follow_up_of).length },
      { label: 'With attachments', value: shown.filter((v) => v.attachments.length > 0).length },
    ],
    [shown],
  );

  const canRecord = role === 'officer';

  function onRecorded(visit: Visit) {
    setVisits((list) => [visit, ...list]);
    setRecorded(farmerName(visit.farmer_id));
  }

  return (
    <div className={styles.page}>
      <header className={styles.head}>
        <p className={styles.eyebrow}>Extension</p>
        <h1 className={styles.h1}>Extension visits</h1>
        <p className={styles.lede}>
          Every field visit an officer records, newest first. An officer sees the visits in their
          caseload; a supervisor and read-only user see their state. Open a visit for the advice
          given and any photos or recordings that came with it.
        </p>
      </header>

      <KpiStrip items={kpis} label="Extension visit summary" />

      {error ? (
        <Notice kind="error">
          <p className="small">{error}</p>
        </Notice>
      ) : null}
      {recorded ? (
        <Notice kind="success" title={`Visit recorded for ${recorded}`}>
          <p className="small">It now sits at the top of the log.</p>
        </Notice>
      ) : null}

      <div className={styles.toolbar}>
        <div className={styles.filters}>
          <div className={styles.filter}>
            <label htmlFor="filter-farmer" className={styles.filterLabel}>
              Farmer
            </label>
            <select
              id="filter-farmer"
              className={styles.filterSelect}
              value={farmer}
              onChange={(e) => setFarmer(e.target.value)}
            >
              <option value="">All farmers</option>
              {farmerOptions.map(([id, name]) => (
                <option key={id} value={id}>
                  {name}
                </option>
              ))}
            </select>
          </div>
          <div className={styles.filter}>
            <label htmlFor="filter-payam" className={styles.filterLabel}>
              Payam
            </label>
            <select
              id="filter-payam"
              className={styles.filterSelect}
              value={payam}
              onChange={(e) => setPayam(e.target.value)}
            >
              <option value="">All payams</option>
              {payamOptions.map(([id, name]) => (
                <option key={id} value={id}>
                  {name}
                </option>
              ))}
            </select>
          </div>
        </div>
        <div className={styles.filters}>
          <span className={styles.count}>
            {shown.length} visit{shown.length === 1 ? '' : 's'}
          </span>
          {canRecord ? (
            <Button variant="primary" size="small" onClick={() => setShowForm(true)}>
              <IconPlus size={16} /> Record a visit
            </Button>
          ) : null}
        </div>
      </div>

      {loading ? <p className={styles.muted}>Loading visits…</p> : null}

      {!loading && shown.length === 0 ? (
        <EmptyState
          title="No visits to show"
          body={
            farmer || payam
              ? 'No visit matches these filters. Clear them to see the whole log.'
              : 'When an officer records a field visit it appears here.'
          }
          actions={
            canRecord ? (
              <Button variant="primary" size="small" onClick={() => setShowForm(true)}>
                <IconPlus size={16} /> Record a visit
              </Button>
            ) : undefined
          }
        />
      ) : null}

      {shown.length > 0 ? (
        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>Visited</th>
                <th>Farmer</th>
                <th>Officer</th>
                <th>Payam</th>
                <th>Topics and advice</th>
                <th>Files</th>
              </tr>
            </thead>
            <tbody>
              {shown.map((v) => (
                <tr
                  key={v.id}
                  className={styles.row}
                  onClick={() => setDetail(v)}
                  tabIndex={0}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      setDetail(v);
                    }
                  }}
                >
                  <td className={styles.num}>
                    <span className={styles.when}>
                      <span>{fmtDate(v.visited_at)}</span>
                      <span className={styles.whenSub}>{fmtTime(v.visited_at)}</span>
                    </span>
                  </td>
                  <td className={styles.strong} dir="auto">
                    {farmerName(v.farmer_id)}
                  </td>
                  <td dir="auto">{officerName(v.officer_id)}</td>
                  <td>{payamName(v.payam_id)}</td>
                  <td>
                    <span className={styles.strong}>
                      {v.topics.map((t) => VISIT_TOPIC_LABELS[t]).join(', ')}
                    </span>
                    <span className={styles.summary} dir="auto">
                      {v.observation ?? v.advice}
                    </span>
                  </td>
                  <td>
                    {v.attachments.length > 0 ? (
                      <span className={styles.clip}>
                        <IconImage size={14} /> {v.attachments.length}
                      </span>
                    ) : (
                      <span className={styles.muted}>—</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}

      {cursor ? (
        <div className={styles.more}>
          <Button variant="secondary" size="small" onClick={loadMore} disabled={loadingMore}>
            {loadingMore ? 'Loading…' : 'Show more'}
          </Button>
        </div>
      ) : null}

      {detail ? <VisitDetail visit={detail} names={names} onClose={() => setDetail(null)} /> : null}
      {showForm && hydrated ? (
        <RecordVisitForm
          farmers={LIVE_VISITS ? names.farmers : undefined}
          names={names}
          onRecorded={onRecorded}
          onClose={() => setShowForm(false)}
        />
      ) : null}
    </div>
  );
}
