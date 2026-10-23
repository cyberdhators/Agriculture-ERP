'use client';

import { useState } from 'react';

import type { SettingKey } from '@agri-erp/shared';

import { Button, Notice } from '@/components/ui';
import { formatDate } from '@/lib/format';

import { asFailure, call, type CurrentSetting } from './api';

/** "Version 3 · saved 12 Mar 2026 by Amina", or that nothing has been saved yet. */
export function VersionLine({ setting }: { setting: CurrentSetting }) {
  if (setting.version === 0) {
    return <p className="small muted">Not set yet: the site shows its built-in default.</p>;
  }
  return (
    <p className="small muted">
      Version {setting.version}
      {setting.changed_at ? ` · saved ${formatDate(setting.changed_at)}` : ''}
      {setting.changed_by ? ` by ${setting.changed_by}` : setting.version === 1 ? ' (seeded)' : ''}
    </p>
  );
}

interface HistoryRow {
  version: number;
  value: unknown;
  changed_at: string;
  changed_by: string | null;
}

/**
 * Every earlier version of one setting, read back on request from
 * GET /api/admin/settings/history. Nothing is overwritten, so nothing here is
 * ever missing; it is shown as saved, for comparison.
 */
export function SettingHistory({ settingKey }: { settingKey: SettingKey }) {
  const [rows, setRows] = useState<HistoryRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = async () => {
    setBusy(true);
    setError(null);
    try {
      setRows(await call<HistoryRow[]>(`/api/admin/settings/history?key=${settingKey}`));
    } catch (e) {
      setError(asFailure(e).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <details
      onToggle={(e) => {
        if ((e.target as HTMLDetailsElement).open && rows === null) void load();
      }}
    >
      <summary className="small">Earlier versions</summary>
      {busy ? <p className="small muted">Loading…</p> : null}
      {error ? (
        <Notice kind="error">
          <p className="small">{error}</p>
          <Button size="small" variant="secondary" onClick={() => void load()}>
            Try again
          </Button>
        </Notice>
      ) : null}
      {rows && rows.length === 0 ? <p className="small muted">Never saved.</p> : null}
      {rows && rows.length > 0 ? (
        <ol style={{ listStyle: 'none', padding: 0, display: 'grid', gap: 8 }}>
          {rows.map((r) => (
            <li key={r.version} style={{ borderTop: '1px solid var(--line)', paddingTop: 8 }}>
              <p className="small">
                <strong>Version {r.version}</strong> · {formatDate(r.changed_at)}
                {r.changed_by ? ` · ${r.changed_by}` : ' · seeded'}
              </p>
              <pre
                className="small mono"
                dir="auto"
                style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word', margin: 0 }}
              >
                {JSON.stringify(r.value, null, 2)}
              </pre>
            </li>
          ))}
        </ol>
      ) : null}
    </details>
  );
}
