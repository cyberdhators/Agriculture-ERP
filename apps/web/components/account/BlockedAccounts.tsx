'use client';

import { useCallback, useEffect, useState } from 'react';

import type { BlockedAccount } from '@agri-erp/shared';

import { Button, Notice } from '@/components/ui';
import { formatDate } from '@/lib/format';
import { t, type Language } from '@/lib/i18n';
import { listBlocks, unblock } from '@/lib/messages/client';

import css from './settings.module.css';

/**
 * BLOCKED ACCOUNTS (2026-10-28). The people this account blocked from a
 * conversation, with Unblock. Shared by the phone-account settings and the
 * email-account profile. Names only, as they appeared in the conversation.
 */
export function BlockedAccounts({
  language,
  variant = 'card',
}: {
  language: Language;
  /**
   * 2026-10-31: 'row' is one settings row -- "Blocked accounts", then "None"
   * or how many -- that opens the list. 'card' is the titled block.
   */
  variant?: 'card' | 'row';
}) {
  const [rows, setRows] = useState<BlockedAccount[] | null>(null);
  const [open, setOpen] = useState(false);
  const [failed, setFailed] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(() => {
    listBlocks()
      .then((list) => {
        setRows(list);
        setFailed(null);
      })
      .catch(() => setFailed(t('blocks.failed', language)));
  }, [language]);

  useEffect(() => {
    load();
  }, [load]);

  async function lift(id: string) {
    setBusy(id);
    setFailed(null);
    try {
      await unblock(id);
      setRows((prev) => (prev ?? []).filter((r) => r.id !== id));
    } catch (e) {
      setFailed(e instanceof Error ? e.message : t('blocks.failed', language));
    } finally {
      setBusy(null);
    }
  }

  const list = rows ? (
    <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'grid', gap: 8 }}>
      {rows.map((row) => (
        <li
          key={row.id}
          style={{
            display: 'flex',
            gap: 8,
            alignItems: 'center',
            justifyContent: 'space-between',
            flexWrap: 'wrap',
          }}
        >
          <span>
            <strong dir="auto">{row.name}</strong>
            <br />
            <span className="small muted">
              {t('blocks.since', language)} {formatDate(row.blocked_at, language)}
            </span>
          </span>
          <Button
            variant="secondary"
            size="small"
            disabled={busy === row.id}
            onClick={() => void lift(row.id)}
          >
            {t('blocks.unblock', language)}
          </Button>
        </li>
      ))}
    </ul>
  ) : null;

  if (variant === 'row') {
    const count = rows?.length ?? 0;
    return (
      <li>
        <button
          type="button"
          className={`${css.row} ${css.rowButton}`}
          aria-expanded={open}
          disabled={count === 0}
          onClick={() => setOpen((v) => !v)}
        >
          <span className={css.rowIcon} aria-hidden>
            <svg
              viewBox="0 0 24 24"
              width="20"
              height="20"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
            >
              <circle cx="12" cy="12" r="8.5" />
              <path d="m6 6 12 12" />
            </svg>
          </span>
          <span className={css.rowText}>
            <span className={css.rowLabel}>{t('set.blocked', language)}</span>
          </span>
          <span className={css.rowValue}>
            {rows === null ? '' : count === 0 ? t('set.none', language) : count}
          </span>
          {count > 0 ? (
            <svg
              className={css.chevron}
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              aria-hidden
            >
              <path d="m9 6 6 6-6 6" />
            </svg>
          ) : null}
        </button>
        {failed ? (
          <div className={css.panel}>
            <Notice kind="error">{failed}</Notice>
          </div>
        ) : null}
        {open && count > 0 ? (
          <div className={css.panel}>
            <p className="small muted">{t('blocks.lead', language)}</p>
            {list}
          </div>
        ) : null}
      </li>
    );
  }

  return (
    <div>
      <h2>{t('blocks.title', language)}</h2>
      <p className="small muted">{t('blocks.lead', language)}</p>
      {failed ? <Notice kind="error">{failed}</Notice> : null}
      {rows === null ? null : rows.length === 0 ? (
        <p className="small">{t('blocks.empty', language)}</p>
      ) : (
        list
      )}
    </div>
  );
}
