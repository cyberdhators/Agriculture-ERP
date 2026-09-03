'use client';

import Link from 'next/link';
import { useState } from 'react';

import { CROP_LABELS, formatDate, formatPhone } from '@/lib/format';
import { duplicateSentence, type DuplicateMatch } from '@/lib/farmers/presentation';
import {
  cropsForFarmer,
  farmerPayamName,
  farmsForFarmer,
  totalAreaHa,
  type Farmer,
} from '@/lib/fixtures/farmers';

import { Button, Dialog } from '../ui';
import { IconWarn } from '../ui/icons';
import styles from './farmers.module.css';

/**
 * The duplicate rule, on screen: an amber-ruled inset that names each possible
 * duplicate and offers a side-by-side compare. It warns and never blocks — the
 * survivor is a person's decision. Same phone, or same name within one payam.
 */
export function DuplicateWarning({
  farmer,
  matches,
}: {
  farmer: Farmer;
  matches: readonly DuplicateMatch[];
}) {
  const [compare, setCompare] = useState<Farmer | null>(null);
  if (matches.length === 0) return null;

  return (
    <div className={styles.dupWarn} role="alert">
      <p className={styles.dupWarnHead}>
        <IconWarn size={18} />
        <span>
          {matches.length === 1
            ? 'Possible duplicate found'
            : `${matches.length} possible duplicates found`}
        </span>
      </p>
      <div className={styles.dupList}>
        {matches.map((m) => (
          <div key={m.farmer.id} className={styles.dupItem}>
            <span className="small">{duplicateSentence(m)}</span>
            <Button variant="secondary" size="small" onClick={() => setCompare(m.farmer)}>
              Compare
            </Button>
          </div>
        ))}
      </div>
      <p className="small muted">
        A possible duplicate never blocks registration. Compare the two records and, if they are the
        same person, merge from the dossier.
      </p>

      <Dialog
        open={compare !== null}
        onClose={() => setCompare(null)}
        title="Compare records"
        footer={
          <Button variant="primary" onClick={() => setCompare(null)}>
            Close
          </Button>
        }
      >
        {compare ? <CompareBody a={farmer} b={compare} /> : null}
      </Dialog>
    </div>
  );
}

function CompareBody({ a, b }: { a: Farmer; b: Farmer }) {
  const rows: ReadonlyArray<{ label: string; a: string; b: string }> = [
    { label: 'Farmer no', a: a.farmer_number, b: b.farmer_number },
    { label: 'Name', a: `${a.given_name} ${a.family_name}`, b: `${b.given_name} ${b.family_name}` },
    { label: 'Sex / YOB', a: `${a.sex.toUpperCase()} · ${a.year_of_birth}`, b: `${b.sex.toUpperCase()} · ${b.year_of_birth}` },
    { label: 'Phone', a: formatPhone(a.phone), b: formatPhone(b.phone) },
    { label: 'Payam', a: farmerPayamName(a.payam_id), b: farmerPayamName(b.payam_id) },
    {
      label: 'Farms',
      a: `${farmsForFarmer(a.id).length} · ${totalAreaHa(a.id).toFixed(2)} ha`,
      b: `${farmsForFarmer(b.id).length} · ${totalAreaHa(b.id).toFixed(2)} ha`,
    },
    {
      label: 'Crops',
      a: cropsForFarmer(a.id).map((c) => CROP_LABELS[c]).join(', ') || '—',
      b: cropsForFarmer(b.id).map((c) => CROP_LABELS[c]).join(', ') || '—',
    },
    { label: 'Registered', a: formatDate(a.created_at), b: formatDate(b.created_at) },
  ];

  return (
    <div className={styles.compareGrid}>
      {[a, b].map((f, i) => (
        <div key={f.id} className={styles.comparePane}>
          <div className={styles.comparePaneHead}>
            <span className="label">{i === 0 ? 'This record' : 'Possible duplicate'}</span>
            <Link href={`/farmers/${f.id}`} className="mono small">
              {f.farmer_number}
            </Link>
          </div>
          {rows.map((r) => {
            const value = i === 0 ? r.a : r.b;
            const same = r.a === r.b;
            return (
              <div key={r.label} className={styles.compareRow}>
                <span className={styles.compareLabel}>{r.label}</span>
                <span className={same ? undefined : styles.compareDiff} dir="auto">
                  {value}
                </span>
              </div>
            );
          })}
        </div>
      ))}
    </div>
  );
}
