'use client';

import { useCallback, useEffect, useState } from 'react';

import type { BlockedAccount } from '@agri-erp/shared';

import { Button, Notice } from '@/components/ui';
import { formatDate } from '@/lib/format';
import { t, type Language } from '@/lib/i18n';
import { listBlocks, unblock } from '@/lib/messages/client';

/**
 * BLOCKED ACCOUNTS (2026-10-28). The people this account blocked from a
 * conversation, with Unblock. Shared by the phone-account settings and the
 * email-account profile. Names only, as they appeared in the conversation.
 */
export function BlockedAccounts({ language }: { language: Language }) {
  const [rows, setRows] = useState<BlockedAccount[] | null>(null);
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

  return (
    <div>
      <h2>{t('blocks.title', language)}</h2>
      <p className="small muted">{t('blocks.lead', language)}</p>
      {failed ? <Notice kind="error">{failed}</Notice> : null}
      {rows === null ? null : rows.length === 0 ? (
        <p className="small">{t('blocks.empty', language)}</p>
      ) : (
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
      )}
    </div>
  );
}
