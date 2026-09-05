'use client';

import { useEffect, useState } from 'react';

import {
  LIVE_ADMIN,
  listOfficers,
  listStaff,
  setOfficerActive,
  type Officer,
  type StaffUser,
} from '@/lib/admin/api';
import { OFFICERS_FIXTURE, PAYAM_NAMES, STAFF_FIXTURE, STATE_NAMES } from '@/lib/admin/fixtures';

import styles from './admin.module.css';

const ROLE_LABEL: Record<string, string> = {
  admin: 'Administrator',
  supervisor: 'Supervisor',
  read_only: 'Read only',
};

const stateName = (id: string | null) => (id ? (STATE_NAMES[id] ?? id) : 'All states');
const payamName = (id: string) => PAYAM_NAMES[id] ?? id;

function fmtDate(iso: string | null): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });
}

/**
 * User administration (deliverable (r), C-3): the staff accounts and the
 * extension officers, read across, with the one write a reviewer needs to see —
 * deactivate and reactivate, which end and restore access at once (C-3.6).
 * Creating and editing accounts is the next unit. Reads the live B3 routes when
 * `NEXT_PUBLIC_USE_LIVE_ADMIN=1`, and sample data otherwise so the screen can be
 * seen before a sign-in endpoint exists.
 */
export function UserAdmin() {
  const [staff, setStaff] = useState<readonly StaffUser[]>(LIVE_ADMIN ? [] : STAFF_FIXTURE);
  const [officers, setOfficers] = useState<readonly Officer[]>(LIVE_ADMIN ? [] : OFFICERS_FIXTURE);
  const [loading, setLoading] = useState(LIVE_ADMIN);
  const [error, setError] = useState<string | undefined>();
  const [busy, setBusy] = useState<string | undefined>();

  useEffect(() => {
    if (!LIVE_ADMIN) return;
    let live = true;
    setLoading(true);
    Promise.all([listStaff(), listOfficers()])
      .then(([s, o]) => {
        if (!live) return;
        setStaff(s);
        setOfficers(o);
        setError(undefined);
      })
      .catch((err: unknown) => {
        if (live) setError(err instanceof Error ? err.message : 'Could not load accounts.');
      })
      .finally(() => live && setLoading(false));
    return () => {
      live = false;
    };
  }, []);

  async function toggleOfficer(officer: Officer) {
    const next = officer.status === 'active' ? 'inactive' : 'active';
    if (!LIVE_ADMIN) {
      setOfficers((list) => list.map((o) => (o.id === officer.id ? { ...o, status: next } : o)));
      return;
    }
    setBusy(officer.id);
    try {
      const updated = await setOfficerActive(officer.id, next === 'active');
      setOfficers((list) => list.map((o) => (o.id === officer.id ? updated : o)));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not update the officer.');
    } finally {
      setBusy(undefined);
    }
  }

  const activeOfficers = officers.filter((o) => o.status === 'active').length;

  return (
    <div className={styles.page}>
      <header className={styles.head}>
        <p className={styles.eyebrow}>Administration</p>
        <h1 className={styles.h1}>User administration</h1>
        <p className={styles.lede}>
          Staff accounts and extension officers. Administrators create, change and deactivate them;
          a supervisor and read-only user see only their own state.
        </p>
      </header>

      {error ? (
        <p className={styles.error} role="alert">
          {error}
        </p>
      ) : null}
      {loading ? <p className={styles.muted}>Loading accounts…</p> : null}

      <section className={styles.section} aria-labelledby="staff-h">
        <div className={styles.sectionHead}>
          <h2 id="staff-h">Staff accounts</h2>
          <span className={styles.count}>
            {staff.length} account{staff.length === 1 ? '' : 's'}
          </span>
        </div>
        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>Name</th>
                <th>Role</th>
                <th>State</th>
                <th>Last sign-in</th>
              </tr>
            </thead>
            <tbody>
              {staff.map((u) => (
                <tr key={u.id}>
                  <td className={styles.strong} dir="auto">
                    {u.name}
                  </td>
                  <td>{ROLE_LABEL[u.role] ?? u.role}</td>
                  <td>{stateName(u.state_id)}</td>
                  <td className={styles.num}>{fmtDate(u.last_login_at)}</td>
                </tr>
              ))}
              {staff.length === 0 && !loading ? (
                <tr>
                  <td colSpan={4} className={styles.empty}>
                    No staff accounts in scope.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </section>

      <section className={styles.section} aria-labelledby="officers-h">
        <div className={styles.sectionHead}>
          <h2 id="officers-h">Extension officers</h2>
          <span className={styles.count}>
            {activeOfficers} active · {officers.length} total
          </span>
        </div>
        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>Name</th>
                <th>Phone</th>
                <th>Payam</th>
                <th>Last sync</th>
                <th>Status</th>
                <th aria-label="Action" />
              </tr>
            </thead>
            <tbody>
              {officers.map((o) => (
                <tr key={o.id}>
                  <td className={styles.strong} dir="auto">
                    {o.name}
                  </td>
                  <td className={styles.num}>{o.phone}</td>
                  <td>{payamName(o.payam_id)}</td>
                  <td className={styles.num}>{fmtDate(o.last_sync_at)}</td>
                  <td>
                    <span
                      className={o.status === 'active' ? styles.stampActive : styles.stampInactive}
                    >
                      {o.status === 'active' ? 'Active' : 'Inactive'}
                    </span>
                  </td>
                  <td className={styles.actionCell}>
                    <button
                      type="button"
                      className={styles.action}
                      disabled={busy === o.id}
                      onClick={() => toggleOfficer(o)}
                    >
                      {o.status === 'active' ? 'Deactivate' : 'Reactivate'}
                    </button>
                  </td>
                </tr>
              ))}
              {officers.length === 0 && !loading ? (
                <tr>
                  <td colSpan={6} className={styles.empty}>
                    No officers in scope.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
