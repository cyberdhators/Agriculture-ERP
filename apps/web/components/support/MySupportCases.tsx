'use client';

import { useEffect, useState } from 'react';

import { caseLabel, type OwnSupportCase, type SupportStatus } from '@agri-erp/shared';

import { formatDate } from '@/lib/format';
import { t, type Language, type TKey } from '@/lib/i18n';

import styles from '@/components/farmer/farmer.module.css';

/**
 * "YOUR MESSAGES TO CORWADO" (2026-10-28). A signed-in farmer or buyer sees
 * their own cases: the case number, where it stands, and CORWADO's replies.
 * Nothing staff-only (notes, evidence, who handled it) ever reaches this
 * route's answer. A visitor gets nothing back, and nothing is shown.
 * `refresh` changes when a new message is sent, to read the list again.
 */

const STATUS_KEY: Record<SupportStatus, TKey> = {
  new: 'help.statusNew',
  in_progress: 'help.statusInProgress',
  waiting: 'help.statusWaiting',
  resolved: 'help.statusResolved',
  closed: 'help.statusClosed',
};

export function MySupportCases({ language, refresh }: { language: Language; refresh: number }) {
  const [cases, setCases] = useState<OwnSupportCase[] | null>(null);

  useEffect(() => {
    let live = true;
    fetch('/api/support', { cache: 'no-store' })
      .then(async (res) => (res.ok ? ((await res.json()) as { data?: OwnSupportCase[] }) : null))
      .then((json) => {
        if (live) setCases(json?.data ?? null);
      })
      .catch(() => live && setCases(null));
    return () => {
      live = false;
    };
  }, [refresh]);

  if (cases === null) return null;

  return (
    <section className={styles.settingCard} id="my-messages">
      <h2>{t('help.mineTitle', language)}</h2>
      <p className="small muted">{t('help.mineLead', language)}</p>
      {cases.length === 0 ? (
        <p className="small">{t('help.mineNone', language)}</p>
      ) : (
        <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'grid', gap: 12 }}>
          {cases.map((c) => (
            <li
              key={c.id}
              style={{ border: '1px solid var(--line)', borderRadius: 8, padding: 12 }}
            >
              <p className="small">
                <strong>
                  {t('help.caseNumber', language)} {caseLabel(c.case_number)}
                </strong>{' '}
                · {t(STATUS_KEY[c.status], language)} · {formatDate(c.created_at, language)}
              </p>
              <p dir="auto" className="small" style={{ whiteSpace: 'pre-wrap' }}>
                {c.body}
              </p>
              {c.replies.length === 0 ? (
                <p className="small muted">{t('help.noAnswerYet', language)}</p>
              ) : (
                c.replies.map((r, i) => (
                  <div
                    key={`${r.created_at}:${i}`}
                    style={{
                      borderInlineStart: '3px solid var(--leaf, #2e7d32)',
                      paddingInlineStart: 10,
                    }}
                  >
                    <p className="small">
                      <strong>{t('help.answer', language)}</strong> ·{' '}
                      {formatDate(r.created_at, language)}
                    </p>
                    <p dir="auto" style={{ whiteSpace: 'pre-wrap' }}>
                      {r.body}
                    </p>
                  </div>
                ))
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
