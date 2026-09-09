'use client';

import { useEffect, useMemo, useState } from 'react';

import {
  Button,
  ButtonLink,
  Card,
  Dialog,
  EmptyState,
  KpiStrip,
  PageHeader,
  SearchInput,
  Stamp,
} from '@/components/ui';
import {
  effectiveStatus,
  scopeFarmers,
  statusStamp,
  PREVIEW_OFFICER_ID,
} from '@/lib/farmers/presentation';
import { LIVE_FARMERS, listFarmers } from '@/lib/farmers/api';
import { FARMERS, farmerPayamName, officerById, type Farmer } from '@/lib/fixtures/farmers';
import { formatDate, formatPhone } from '@/lib/format';

import styles from './officer.module.css';

const TODAY_YEAR = 2026;
const STATUS_LABEL: Record<string, string> = {
  pending: 'Pending verification',
  verified: 'Verified',
  rejected: 'Rejected',
  merged: 'Merged',
};

/**
 * The extension officer's field desk: their own caseload at a glance, a
 * prominent way to register a farmer, a quick find, and a printable
 * registration slip to hand the farmer or keep for records. Reads the officer's
 * caseload from GET /api/farmers (scoped to what they registered) when
 * NEXT_PUBLIC_USE_LIVE_FARMERS is set, otherwise the fixtures. Farmers do not
 * authenticate in this phase, so there is no password to set here.
 */
export function OfficerDesk() {
  const officer = officerById(PREVIEW_OFFICER_ID);
  const [live, setLive] = useState<Farmer[] | null>(null);
  const [q, setQ] = useState('');
  const [slip, setSlip] = useState<Farmer | null>(null);

  useEffect(() => {
    if (!LIVE_FARMERS) return;
    let on = true;
    listFarmers({ limit: 200 })
      .then((r) => on && setLive(r.farmers))
      .catch(() => on && setLive([]));
    return () => {
      on = false;
    };
  }, []);

  const caseload = LIVE_FARMERS
    ? (live ?? [])
    : scopeFarmers(FARMERS, 'officer').filter((f) => f.merged_into === null);

  const kpis = useMemo(() => {
    let pending = 0;
    let verified = 0;
    for (const f of caseload) {
      const s = effectiveStatus(f);
      if (s === 'pending') pending += 1;
      else if (s === 'verified') verified += 1;
    }
    return { registered: caseload.length, pending, verified };
  }, [caseload]);

  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const rows = needle
      ? caseload.filter((f) =>
          `${f.given_name} ${f.family_name} ${f.phone} ${f.farmer_number}`
            .toLowerCase()
            .includes(needle),
        )
      : caseload;
    return [...rows].sort((a, b) => b.created_at.localeCompare(a.created_at));
  }, [caseload, q]);

  return (
    <>
      <div className="no-print">
        <PageHeader
          eyebrow="Farmers · Field desk"
          title="Field desk"
          subtitle={
            officer
              ? `${officer.name} · ${farmerPayamName(officer.payam_id)}. Register farmers and keep your caseload moving.`
              : 'Register farmers and keep your caseload moving.'
          }
          actions={
            <ButtonLink href="/farmers/new" variant="primary">
              Register a farmer
            </ButtonLink>
          }
        />

        <div className={styles.kpi}>
          <KpiStrip
            label="Your caseload"
            items={[
              { label: 'Registered', value: kpis.registered },
              { label: 'Pending verification', value: kpis.pending, accent: kpis.pending > 0 },
              { label: 'Verified', value: kpis.verified },
            ]}
          />
        </div>

        <div className={styles.find}>
          <SearchInput
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Find a farmer by name, phone or number"
            label="Find a farmer in your caseload"
          />
        </div>

        {shown.length === 0 ? (
          <EmptyState
            title={q ? 'No farmer matches' : 'No farmers yet'}
            body={
              q
                ? 'Try a different name, phone or farmer number.'
                : 'Register your first farmer and it will appear here, pending a supervisor’s review.'
            }
            actions={<ButtonLink href="/farmers/new">Register a farmer</ButtonLink>}
          />
        ) : (
          <ul className={styles.list}>
            {shown.map((f) => {
              const s = effectiveStatus(f);
              return (
                <li key={f.id}>
                  <Card padded className={styles.row}>
                    <div className={styles.rowMain}>
                      <span className={styles.rowName} dir="auto">
                        {f.given_name} {f.family_name}
                      </span>
                      <span className={styles.rowMeta}>
                        <span className="mono">{f.farmer_number}</span> ·{' '}
                        {farmerPayamName(f.payam_id)} ·{' '}
                        <span className="mono">{formatPhone(f.phone)}</span>
                      </span>
                    </div>
                    <Stamp kind={statusStamp(f)}>{STATUS_LABEL[s] ?? s}</Stamp>
                    <Button variant="secondary" size="small" onClick={() => setSlip(f)}>
                      Slip
                    </Button>
                  </Card>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      {slip ? (
        <Dialog
          open
          onClose={() => setSlip(null)}
          title="Registration slip"
          footer={
            <>
              <Button variant="ghost" onClick={() => setSlip(null)}>
                Close
              </Button>
              <Button variant="primary" onClick={() => window.print()}>
                Print
              </Button>
            </>
          }
        >
          <div className={`${styles.slip} print-flat`}>
            <p className={styles.slipHead}>AgriOne · Registration slip</p>
            <dl className={styles.slipRows}>
              <div>
                <dt>Farmer number</dt>
                <dd className="mono">{slip.farmer_number}</dd>
              </div>
              <div>
                <dt>Name</dt>
                <dd dir="auto">
                  {slip.given_name} {slip.family_name}
                </dd>
              </div>
              <div>
                <dt>Sex · age</dt>
                <dd>
                  {slip.sex === 'f' ? 'F' : 'M'} ·{' '}
                  <span className="mono">{TODAY_YEAR - slip.year_of_birth}</span>
                </dd>
              </div>
              <div>
                <dt>Phone</dt>
                <dd className="mono">{formatPhone(slip.phone)}</dd>
              </div>
              <div>
                <dt>Payam</dt>
                <dd>{farmerPayamName(slip.payam_id)}</dd>
              </div>
              <div>
                <dt>Registered</dt>
                <dd>{formatDate(slip.created_at)}</dd>
              </div>
              <div>
                <dt>Status</dt>
                <dd>{STATUS_LABEL[effectiveStatus(slip)] ?? effectiveStatus(slip)}</dd>
              </div>
            </dl>
            <p className={styles.slipNote}>
              Keep this slip. A supervisor reviews the registration; the farmer number is permanent.
            </p>
          </div>
        </Dialog>
      ) : null}
    </>
  );
}
