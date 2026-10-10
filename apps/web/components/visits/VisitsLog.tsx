'use client';

import { useEffect, useMemo, useRef, useState } from 'react';

import { Button, Dialog, EmptyState, Field, KpiStrip, Notice, Textarea } from '@/components/ui';
import { IconImage, IconPlus } from '@/components/ui/icons';
import { isNoSignal } from '@/lib/offline/net';
import { VISIT_KIND } from '@/lib/offline/officer';
import { queuedOf, subscribeOutbox } from '@/lib/offline/outbox';
import { loadWithSnapshot } from '@/lib/offline/snapshot';
import { usePreview } from '@/lib/preview';
import { correctVisit, listVisits, LIVE_VISITS, removeVisit, type Visit } from '@/lib/visits/api';
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
  const [reloadKey, setReloadKey] = useState(0);
  const waitingRef = useRef<ReadonlySet<string>>(new Set());
  const [error, setError] = useState<string | undefined>();
  const [cursor, setCursor] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);

  const [farmer, setFarmer] = useState('');
  const [payam, setPayam] = useState('');
  const [detail, setDetail] = useState<Visit | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [recorded, setRecorded] = useState<string | undefined>();
  const [recordedKept, setRecordedKept] = useState(false);
  const [correcting, setCorrecting] = useState<Visit | null>(null);
  const [removing, setRemoving] = useState<Visit | null>(null);
  const [busy, setBusy] = useState(false);
  const [advice, setAdvice] = useState('');
  const [observation, setObservation] = useState('');
  const [actionError, setActionError] = useState<string | undefined>();
  /** PWA: visits recorded on this phone, not sent yet (their ids). */
  const [waiting, setWaiting] = useState<ReadonlySet<string>>(new Set());
  /** PWA: when the list shown was saved, if it is this phone's copy. */
  const [savedAt, setSavedAt] = useState<number | null>(null);

  useEffect(() => {
    if (!LIVE_VISITS) return;
    let live = true;
    setLoading(true);
    // PWA (2026-10-10): with no signal, the first page saved on this phone.
    loadWithSnapshot('officer.visits', () => listVisits(), isNoSignal)
      .then((got) => {
        if (!live || !got) return;
        const page = got.data;
        setVisits((shown) => {
          // Keep visits recorded on this phone that the server does not have yet.
          const sent = new Set(page.visits.map((v) => v.id));
          return [
            ...shown.filter((v) => waitingRef.current.has(v.id) && !sent.has(v.id)),
            ...page.visits,
          ];
        });
        setCursor(got.fresh && page.hasMore ? page.cursor : null);
        setSavedAt(got.fresh ? null : got.savedAt);
        setError(undefined);
      })
      .catch((err: unknown) => {
        if (live) setError(err instanceof Error ? err.message : 'Could not load visits.');
      })
      .finally(() => live && setLoading(false));
    return () => {
      live = false;
    };
  }, [reloadKey]);

  // PWA: which visits are still on this phone; when one is sent, reload.
  useEffect(() => {
    if (!LIVE_VISITS) return;
    let before = -1;
    const check = () =>
      void queuedOf(VISIT_KIND).then((q) => {
        const ids = new Set(q.map((x) => x.id.replace(/^visit:/, '')));
        waitingRef.current = ids;
        setWaiting(ids);
        if (before >= 0 && q.length < before) setReloadKey((k) => k + 1);
        before = q.length;
      });
    check();
    const off = subscribeOutbox(check);
    return () => {
      off();
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
  /** Correction and soft removal are the administrator's; fieldwork is not. */
  const isAdmin = hydrated && role === 'admin';

  function onRecorded(visit: Visit) {
    setVisits((list) => [visit, ...list]);
    void queuedOf(VISIT_KIND).then((q) => {
      const kept = q.some((x) => x.id === `visit:${visit.id}`);
      if (kept) {
        waitingRef.current = new Set([...waitingRef.current, visit.id]);
        setWaiting(waitingRef.current);
      }
      setRecordedKept(kept);
      setRecorded(farmerName(visit.farmer_id));
    });
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
        <Notice
          kind={recordedKept ? 'info' : 'success'}
          title={
            recordedKept
              ? `Visit for ${recorded} saved on this phone, waiting to send`
              : `Visit recorded for ${recorded}`
          }
        >
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

      {savedAt ? (
        <Notice kind="info" title="No signal: showing the list saved on this phone">
          <p className="small">
            Saved {fmtDate(new Date(savedAt).toISOString())}{' '}
            {fmtTime(new Date(savedAt).toISOString())}. Visits you record now are kept on the phone
            and sent when there is signal.
          </p>
        </Notice>
      ) : null}

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
                {isAdmin ? <th className="no-print">Record</th> : null}
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
                      {waiting.has(v.id) ? (
                        <span className={styles.whenSub}>Waiting to send</span>
                      ) : null}
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
                  {/*
                   * ADMINISTRATIVE CUSTODY OF THE RECORD, not fieldwork.
                   * "Correct" changes what is stored; it does not re-record a
                   * visit, and nothing here captures a position or a GPS
                   * reading. "Remove" is soft. Both stop the row's own click
                   * from opening the detail behind the dialog.
                   */}
                  {isAdmin ? (
                    <td className="no-print">
                      <span className={styles.rowActions}>
                        <Button
                          variant="secondary"
                          size="small"
                          onClick={(e) => {
                            e.stopPropagation();
                            setCorrecting(v);
                          }}
                        >
                          Correct
                        </Button>
                        <Button
                          variant="danger"
                          size="small"
                          onClick={(e) => {
                            e.stopPropagation();
                            setRemoving(v);
                          }}
                        >
                          Remove
                        </Button>
                      </span>
                    </td>
                  ) : null}
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

      {/*
       * CORRECT VISIT — `PATCH /api/visits/:id`, and only what
       * `correctVisitSchema` accepts. The advice and the observation are the
       * two a custodian of the record actually corrects; the position, the GPS
       * accuracy, the farmer, the officer and the moment of the visit are what
       * the field recorded and the schema does not take them. Nothing here
       * claims the visit itself changed — only the record of it.
       */}
      <Dialog
        open={correcting !== null}
        onClose={() => setCorrecting(null)}
        title="Correct visit"
        footer={
          <>
            <Button variant="ghost" onClick={() => setCorrecting(null)}>
              Cancel
            </Button>
            <Button
              variant="primary"
              disabled={busy || (advice.trim() === '' && observation.trim() === '')}
              onClick={() => {
                if (!correcting) return;
                setBusy(true);
                setActionError(undefined);
                const patch = {
                  ...(advice.trim() ? { advice: advice.trim() } : {}),
                  ...(observation.trim() ? { observation: observation.trim() } : {}),
                };
                correctVisit(correcting.id, patch)
                  .then((updated) => {
                    setVisits((list) => list.map((v) => (v.id === updated.id ? updated : v)));
                    setRecorded('The stored record was corrected.');
                    setCorrecting(null);
                    setAdvice('');
                    setObservation('');
                  })
                  .catch((e: unknown) =>
                    setActionError(
                      e instanceof Error ? e.message : 'The correction could not be saved.',
                    ),
                  )
                  .finally(() => setBusy(false));
              }}
            >
              {busy ? 'Saving…' : 'Save correction'}
            </Button>
          </>
        }
      >
        {actionError ? (
          <Notice kind="error">
            <p className="small">{actionError}</p>
          </Notice>
        ) : null}
        <p className="small muted">
          This changes the stored record. It does not change what happened in the field, and it
          cannot alter where or when the visit was recorded.
        </p>
        <Field
          label="Advice given"
          optional
          hint={correcting ? `Currently: ${correcting.advice}` : undefined}
        >
          {(ids) => (
            <Textarea
              {...ids}
              value={advice}
              onChange={(e) => setAdvice(e.target.value)}
              placeholder="Leave blank to keep the recorded advice"
            />
          )}
        </Field>
        <Field
          label="Observation"
          optional
          hint={correcting?.observation ? `Currently: ${correcting.observation}` : 'None recorded'}
        >
          {(ids) => (
            <Textarea
              {...ids}
              value={observation}
              onChange={(e) => setObservation(e.target.value)}
              placeholder="Leave blank to keep the recorded observation"
            />
          )}
        </Field>
      </Dialog>

      {/* SOFT REMOVAL. No permanent deletion exists, and no route restores. */}
      <Dialog
        open={removing !== null}
        onClose={() => setRemoving(null)}
        title="Remove visit?"
        footer={
          <>
            <Button variant="ghost" onClick={() => setRemoving(null)}>
              Cancel
            </Button>
            <Button
              variant="danger"
              disabled={busy}
              onClick={() => {
                if (!removing) return;
                setBusy(true);
                setActionError(undefined);
                removeVisit(removing.id)
                  .then(() => {
                    setVisits((list) => list.filter((v) => v.id !== removing.id));
                    setRecorded('The visit was removed from active lists and reporting.');
                    setRemoving(null);
                  })
                  .catch((e: unknown) =>
                    setActionError(
                      e instanceof Error ? e.message : 'The visit could not be removed.',
                    ),
                  )
                  .finally(() => setBusy(false));
              }}
            >
              {busy ? 'Removing…' : 'Remove visit'}
            </Button>
          </>
        }
      >
        {removing ? (
          <>
            <p>
              Remove the visit to <strong dir="auto">{farmerName(removing.farmer_id)}</strong> on{' '}
              {fmtDate(removing.visited_at)}?
            </p>
            <p className="small muted">
              The visit leaves active lists, counts, exports and reach figures. The record and its
              audit trail remain. This is not a permanent deletion, and nothing restores it.
            </p>
          </>
        ) : null}
      </Dialog>

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
