'use client';

import { useCallback, useEffect, useState } from 'react';

import {
  LIVE_ADMIN,
  deactivateStaff,
  listOfficers,
  listStaff,
  setOfficerActive,
  type Officer,
  type StaffUser,
} from '@/lib/admin/api';
import {
  DEACTIVATION_WARNING,
  ROLE_LABELS,
  SELF_ACTION_NOTE,
  canRemoveAccount,
  canSetPasswordFor,
  deactivationOutcome,
  scopeLabel,
} from '@/lib/admin/account-rules';
import { OFFICERS_FIXTURE, PAYAM_NAMES, STAFF_FIXTURE, STATE_NAMES } from '@/lib/admin/fixtures';
import { formatDate, formatPhone } from '@/lib/format';
import { usePreview } from '@/lib/preview';

import { Button, Dialog, Notice, PageHeader, Stamp } from '../ui';
import { CardSkeleton, DataTable, Pagination } from '../ui/data';
import { AccountForm } from './AccountForm';
import styles from './admin.module.css';

/**
 * STAFF ACCOUNTS AND EXTENSION OFFICERS — one administrative workspace, two
 * records that are not the same thing.
 *
 * A staff account is an authentication identity with a role and a scope. An
 * extension officer is a field-workforce record with a phone and a payam. They
 * live in different tables, are created by different routes with different
 * schemas, and one is not a kind of the other — so the page keeps them in two
 * labelled sections rather than one list with a "type" column. The navigation
 * already points at both, and splitting them into two routes would have
 * duplicated the concept rather than clarified it.
 *
 * WHAT CHANGED HERE, AND WHY IT MATTERED. Both lists used to fetch their first
 * page and throw the cursor away, then present the result as the national
 * list. Both now page properly. And the officer status toggle discarded the
 * one number the deactivation route exists to return: how many farmers that
 * act just left without a working officer.
 *
 * EVERY WRITE IS ADMINISTRATOR-ONLY, and the server says so too. Nothing here
 * relies on a hidden button: a supervisor or read-only user who reaches this
 * screen reads the lists their routes already allow and is offered no action.
 */

type OpenForm =
  { kind: 'staff'; staff?: StaffUser } | { kind: 'officer'; officer?: Officer } | null;

type Confirm =
  | { kind: 'remove-staff'; staff: StaffUser }
  | { kind: 'deactivate-officer'; officer: Officer }
  | null;

const PAGE_SIZE = 25;

const stateNameOf = (id: string | null) => (id ? (STATE_NAMES[id] ?? id) : null);
const payamNameOf = (id: string) => PAYAM_NAMES[id] ?? id;

export function UserAdmin() {
  const { role, me, hydrated } = usePreview();
  const isAdmin = hydrated && role === 'admin';

  const [staff, setStaff] = useState<readonly StaffUser[]>(LIVE_ADMIN ? [] : STAFF_FIXTURE);
  const [officers, setOfficers] = useState<readonly Officer[]>(LIVE_ADMIN ? [] : OFFICERS_FIXTURE);
  const [loading, setLoading] = useState(LIVE_ADMIN);
  const [error, setError] = useState<string | undefined>();
  const [busy, setBusy] = useState<string | undefined>();
  const [outcome, setOutcome] = useState<string | undefined>();
  const [form, setForm] = useState<OpenForm>(null);
  const [confirm, setConfirm] = useState<Confirm>(null);

  /** Cursor state per list. The route reports no total, so there is no page number. */
  const [staffCursor, setStaffCursor] = useState<string | null>(null);
  const [staffBack, setStaffBack] = useState<Array<string | null>>([]);
  const [staffNext, setStaffNext] = useState<string | null>(null);
  const [staffMore, setStaffMore] = useState(false);
  /** Administrator, first page only. Absent otherwise — never rendered as zero. */
  const [orphanAccounts, setOrphanAccounts] = useState<number | undefined>();

  const [officerCursor, setOfficerCursor] = useState<string | null>(null);
  const [officerBack, setOfficerBack] = useState<Array<string | null>>([]);
  const [officerNext, setOfficerNext] = useState<string | null>(null);
  const [officerMore, setOfficerMore] = useState(false);

  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (!LIVE_ADMIN) return;
    let live = true;
    setLoading(true);
    Promise.all([
      listStaff({ cursor: staffCursor ?? undefined, limit: PAGE_SIZE }),
      listOfficers({ cursor: officerCursor ?? undefined, limit: PAGE_SIZE }),
    ])
      .then(([s, o]) => {
        if (!live) return;
        setStaff(s.rows);
        setStaffNext(s.cursor);
        setStaffMore(s.hasMore);
        setOrphanAccounts(s.orphanAuthAccounts);
        setOfficers(o.rows);
        setOfficerNext(o.cursor);
        setOfficerMore(o.hasMore);
        setError(undefined);
      })
      .catch((err: unknown) => {
        // The platform's rule: a failed authorisation-dependent request is not
        // a reason to send anybody to the sign-in page. Report it and offer a
        // retry; the session is the middleware's business, not this screen's.
        if (live) setError(err instanceof Error ? err.message : 'Could not load this information.');
      })
      .finally(() => live && setLoading(false));
    return () => {
      live = false;
    };
  }, [staffCursor, officerCursor, attempt]);

  const upsertStaff = (u: StaffUser) =>
    setStaff((list) =>
      list.some((x) => x.id === u.id) ? list.map((x) => (x.id === u.id ? u : x)) : [u, ...list],
    );
  const upsertOfficer = (o: Officer) =>
    setOfficers((list) =>
      list.some((x) => x.id === o.id) ? list.map((x) => (x.id === o.id ? o : x)) : [o, ...list],
    );

  /** Deactivate, then report the number the SERVER counted. Never our own. */
  const deactivateOfficer = useCallback(async (officer: Officer) => {
    setBusy(officer.id);
    setOutcome(undefined);
    try {
      if (!LIVE_ADMIN) {
        setOfficers((list) =>
          list.map((o) => (o.id === officer.id ? { ...o, status: 'inactive' } : o)),
        );
        setOutcome(
          `Recorded (preview, no server): ${officer.name} deactivated. No count is available without the server.`,
        );
      } else {
        const result = await setOfficerActive(officer.id, false);
        setOfficers((list) => list.map((o) => (o.id === officer.id ? result.officer : o)));
        setOutcome(deactivationOutcome(officer.name, result.unassignedFarmers));
      }
      setConfirm(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not update the officer.');
    } finally {
      setBusy(undefined);
    }
  }, []);

  const reactivateOfficer = useCallback(async (officer: Officer) => {
    setBusy(officer.id);
    try {
      if (!LIVE_ADMIN) {
        setOfficers((list) =>
          list.map((o) => (o.id === officer.id ? { ...o, status: 'active' } : o)),
        );
      } else {
        const result = await setOfficerActive(officer.id, true);
        setOfficers((list) => list.map((o) => (o.id === officer.id ? result.officer : o)));
      }
      setOutcome(`${officer.name} reactivated. Access is restored.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not update the officer.');
    } finally {
      setBusy(undefined);
    }
  }, []);

  const removeStaff = useCallback(async (account: StaffUser) => {
    setBusy(account.id);
    setOutcome(undefined);
    try {
      if (LIVE_ADMIN) await deactivateStaff(account.id);
      setStaff((list) => list.filter((u) => u.id !== account.id));
      setOutcome(`${account.name} removed. The account no longer has access; its history remains.`);
      setConfirm(null);
    } catch (err) {
      // The server owns the last-administrator rule and refuses under a lock.
      // Its sentence is the one the reader gets; nothing is invented here and
      // nothing claims success.
      setError(err instanceof Error ? err.message : 'The account could not be removed.');
    } finally {
      setBusy(undefined);
    }
  }, []);

  if (!hydrated) return null;

  const viewerId = me?.id ?? null;

  return (
    <div className={styles.page}>
      <PageHeader
        eyebrow="People & access"
        title="Staff accounts and extension officers"
        subtitle="Administrative access and account lifecycle, and the field workforce with their payam assignments. Two separate records; an account is not an officer."
      />

      {error ? (
        <Notice kind="error" title="Could not load this information">
          <p className="small">
            {error}{' '}
            <Button variant="ghost" size="small" onClick={() => setAttempt((n) => n + 1)}>
              Try again
            </Button>
          </p>
        </Notice>
      ) : null}

      {outcome ? (
        <Notice kind="success" title="Recorded">
          <p className="small">{outcome}</p>
        </Notice>
      ) : null}

      {/* ---- Staff accounts ------------------------------------------- */}
      <section className={styles.section} aria-labelledby="staff-h">
        <div className={styles.sectionHead}>
          <div>
            <h2 id="staff-h">Staff &amp; accounts</h2>
            <p className="small muted">Administrative access and account lifecycle.</p>
          </div>
          {isAdmin ? (
            <Button onClick={() => setForm({ kind: 'staff' })}>Add staff account</Button>
          ) : null}
        </div>

        {/*
         * The administrator-only diagnostic, shown only when the route sent it.
         * It is computed for an administrator on the first page alone, because
         * it scans every authentication account; absent is absent, and nothing
         * here turns that into a zero.
         */}
        {isAdmin && orphanAccounts !== undefined && orphanAccounts > 0 ? (
          <Notice kind="warn" title="Orphaned authentication accounts">
            <p className="small">
              {orphanAccounts.toLocaleString('en')} authentication{' '}
              {orphanAccounts === 1 ? 'account exists' : 'accounts exist'} with no staff record.
              These are the residue of account creations that failed part-way.
            </p>
          </Notice>
        ) : null}

        {loading ? (
          <CardSkeleton count={3} />
        ) : (
          <>
            <DataTable
              caption="Staff accounts with their role and scope"
              rows={[...staff]}
              rowKey={(u) => u.id}
              empty={<p className="small muted">No staff accounts to show.</p>}
              columns={[
                {
                  key: 'name',
                  header: 'Name',
                  rowHeader: true,
                  render: (u) => (
                    <>
                      <span dir="auto">{u.name}</span>
                      {u.id === viewerId ? <span className="small muted"> · you</span> : null}
                    </>
                  ),
                },
                {
                  key: 'role',
                  header: 'Role',
                  nowrap: true,
                  render: (u) => ROLE_LABELS[u.role] ?? u.role,
                },
                {
                  key: 'scope',
                  header: 'Scope',
                  nowrap: true,
                  render: (u) => scopeLabel(u.role, stateNameOf(u.state_id)),
                },
                {
                  key: 'last_login',
                  header: 'Last sign-in',
                  nowrap: true,
                  render: (u) =>
                    u.last_login_at ? (
                      formatDate(u.last_login_at)
                    ) : (
                      <span className="muted">Never</span>
                    ),
                },
                {
                  key: 'actions',
                  header: 'Actions',
                  printHidden: true,
                  nowrap: true,
                  render: (u) =>
                    !isAdmin ? (
                      <span className="muted small">View only</span>
                    ) : (
                      <span className={styles.rowActions}>
                        <Button
                          variant="secondary"
                          size="small"
                          onClick={() => setForm({ kind: 'staff', staff: u })}
                        >
                          Edit
                        </Button>
                        {canRemoveAccount({ viewerId, targetId: u.id }) ? (
                          <Button
                            variant="danger"
                            size="small"
                            disabled={busy === u.id}
                            onClick={() => setConfirm({ kind: 'remove-staff', staff: u })}
                          >
                            Remove
                          </Button>
                        ) : (
                          <span className="muted small" title={SELF_ACTION_NOTE}>
                            Your account
                          </span>
                        )}
                      </span>
                    ),
                },
              ]}
            />
            {LIVE_ADMIN ? (
              <Pagination
                shown={staff.length}
                hasMore={staffMore}
                busy={loading}
                canGoBack={staffBack.length > 0}
                onNext={() => {
                  if (!staffNext) return;
                  setStaffBack((past) => [...past, staffCursor]);
                  setStaffCursor(staffNext);
                }}
                onPrevious={() =>
                  setStaffBack((past) => {
                    if (past.length === 0) return past;
                    setStaffCursor(past[past.length - 1] ?? null);
                    return past.slice(0, -1);
                  })
                }
              />
            ) : null}
          </>
        )}
      </section>

      {/* ---- Extension officers --------------------------------------- */}
      <section id="officers" className={styles.section} aria-labelledby="officers-h">
        <div className={styles.sectionHead}>
          <div>
            <h2 id="officers-h">Extension officers</h2>
            <p className="small muted">Field workforce and payam assignments.</p>
          </div>
          {isAdmin ? (
            <Button onClick={() => setForm({ kind: 'officer' })}>Add extension officer</Button>
          ) : null}
        </div>

        {loading ? (
          <CardSkeleton count={3} />
        ) : (
          <>
            <DataTable
              caption="Extension officers with their assignment and status"
              rows={[...officers]}
              rowKey={(o) => o.id}
              empty={<p className="small muted">No extension officers to show.</p>}
              columns={[
                {
                  key: 'name',
                  header: 'Name',
                  rowHeader: true,
                  render: (o) => <span dir="auto">{o.name}</span>,
                },
                {
                  key: 'phone',
                  header: 'Phone',
                  nowrap: true,
                  render: (o) => <span className="mono">{formatPhone(o.phone)}</span>,
                },
                {
                  key: 'assignment',
                  header: 'Assignment',
                  render: (o) =>
                    `${stateNameOf(o.state_id) ?? o.state_id} › ${payamNameOf(o.payam_id)}`,
                },
                {
                  key: 'sync',
                  header: 'Last sync',
                  nowrap: true,
                  render: (o) =>
                    o.last_sync_at ? (
                      formatDate(o.last_sync_at)
                    ) : (
                      <span className="muted">Never</span>
                    ),
                },
                {
                  key: 'status',
                  header: 'Status',
                  nowrap: true,
                  render: (o) => (
                    <Stamp kind={o.status === 'active' ? 'verified' : 'neutral'}>
                      {o.status === 'active' ? 'Active' : 'Inactive'}
                    </Stamp>
                  ),
                },
                {
                  key: 'actions',
                  header: 'Actions',
                  printHidden: true,
                  nowrap: true,
                  render: (o) =>
                    !isAdmin ? (
                      <span className="muted small">View only</span>
                    ) : (
                      <span className={styles.rowActions}>
                        <Button
                          variant="secondary"
                          size="small"
                          onClick={() => setForm({ kind: 'officer', officer: o })}
                        >
                          Edit
                        </Button>
                        {o.status === 'active' ? (
                          <Button
                            variant="danger"
                            size="small"
                            disabled={busy === o.id}
                            onClick={() => setConfirm({ kind: 'deactivate-officer', officer: o })}
                          >
                            Deactivate
                          </Button>
                        ) : (
                          <Button
                            variant="secondary"
                            size="small"
                            disabled={busy === o.id}
                            onClick={() => void reactivateOfficer(o)}
                          >
                            Reactivate
                          </Button>
                        )}
                      </span>
                    ),
                },
              ]}
            />
            {LIVE_ADMIN ? (
              <Pagination
                shown={officers.length}
                hasMore={officerMore}
                busy={loading}
                canGoBack={officerBack.length > 0}
                onNext={() => {
                  if (!officerNext) return;
                  setOfficerBack((past) => [...past, officerCursor]);
                  setOfficerCursor(officerNext);
                }}
                onPrevious={() =>
                  setOfficerBack((past) => {
                    if (past.length === 0) return past;
                    setOfficerCursor(past[past.length - 1] ?? null);
                    return past.slice(0, -1);
                  })
                }
              />
            ) : null}
          </>
        )}
      </section>

      {/* ---- Confirmations -------------------------------------------- */}
      <Dialog
        open={confirm?.kind === 'remove-staff'}
        onClose={() => setConfirm(null)}
        title="Remove this account?"
        footer={
          <>
            <Button variant="ghost" onClick={() => setConfirm(null)}>
              Cancel
            </Button>
            <Button
              variant="danger"
              disabled={busy !== undefined}
              onClick={() =>
                confirm?.kind === 'remove-staff' ? void removeStaff(confirm.staff) : undefined
              }
            >
              {busy ? 'Removing…' : 'Remove account'}
            </Button>
          </>
        }
      >
        <p>
          Remove{' '}
          <strong dir="auto">{confirm?.kind === 'remove-staff' ? confirm.staff.name : ''}</strong>?
        </p>
        <p className="small muted">
          This disables the account and ends any session already open. Historical records remain:
          everything this account did stays in the audit trail. This is not a permanent deletion.
        </p>
      </Dialog>

      <Dialog
        open={confirm?.kind === 'deactivate-officer'}
        onClose={() => setConfirm(null)}
        title="Deactivate extension officer?"
        footer={
          <>
            <Button variant="ghost" onClick={() => setConfirm(null)}>
              Cancel
            </Button>
            <Button
              variant="danger"
              disabled={busy !== undefined}
              onClick={() =>
                confirm?.kind === 'deactivate-officer'
                  ? void deactivateOfficer(confirm.officer)
                  : undefined
              }
            >
              {busy ? 'Deactivating…' : 'Deactivate officer'}
            </Button>
          </>
        }
      >
        {confirm?.kind === 'deactivate-officer' ? (
          <>
            <p>
              <strong dir="auto">{confirm.officer.name}</strong>
            </p>
            <p className="small muted">
              Current assignment:{' '}
              {stateNameOf(confirm.officer.state_id) ?? confirm.officer.state_id} ·{' '}
              {payamNameOf(confirm.officer.payam_id)}
            </p>
            <p>{DEACTIVATION_WARNING}</p>
            <p className="small muted">
              Deactivation ends this officer&apos;s access at once. It is not a deletion: the
              officer record and their history remain.
            </p>
          </>
        ) : null}
      </Dialog>

      {form ? (
        <AccountForm
          kind={form.kind}
          {...(form.kind === 'staff' ? { staff: form.staff } : { officer: form.officer })}
          canSetPassword={
            form.kind === 'staff' && form.staff
              ? canSetPasswordFor({ viewerId, targetId: form.staff.id })
              : true
          }
          onClose={() => setForm(null)}
          onSavedStaff={(u) => {
            upsertStaff(u);
            setForm(null);
            setOutcome(`${u.name} saved.`);
          }}
          onSavedOfficer={(o) => {
            upsertOfficer(o);
            setForm(null);
            setOutcome(`${o.name} saved.`);
          }}
        />
      ) : null}
    </div>
  );
}
