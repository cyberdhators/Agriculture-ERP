'use client';

import { useEffect, useState } from 'react';

import { caseLabel, type OwnSupportCase, type SupportStatus } from '@agri-erp/shared';

import { formatDate } from '@/lib/format';
import { t, type Language, type TKey } from '@/lib/i18n';

import css from '@/components/account/settings.module.css';

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

  // 2026-10-31: a group title over one white list, a case per row; the lead
  // ("each message has a case number") went -- every row shows its number.
  return (
    <section className={css.group} id="my-messages" aria-labelledby="my-messages-title">
      <h2 id="my-messages-title" className={css.groupTitle}>
        {t('help.mineTitle', language)}
      </h2>
      {cases.length === 0 ? (
        <div className={css.formCard}>
          <p className="small muted">{t('help.mineNone', language)}</p>
        </div>
      ) : (
        <ul className={css.list}>
          {cases.map((c) => (
            <li key={c.id} style={{ display: 'grid', gap: 'var(--s-2)', padding: 'var(--s-4)' }}>
              <p className="small">
                <strong>
                  {t('help.caseNumber', language)} {caseLabel(c.case_number)}
                </strong>{' '}
                <span className="muted">
                  · {t(STATUS_KEY[c.status], language)} · {formatDate(c.created_at, language)}
                </span>
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
                      display: 'grid',
                      gap: 2,
                      padding: 'var(--s-3)',
                      borderInlineStart: '3px solid var(--green)',
                      borderRadius: 'var(--radius-control)',
                      background: 'var(--green-tint)',
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
