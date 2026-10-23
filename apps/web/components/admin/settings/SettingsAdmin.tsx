'use client';

import { useCallback, useEffect, useState } from 'react';

import type { SettingKey } from '@agri-erp/shared';

import { Button, Notice, PageHeader, Tabs } from '@/components/ui';
import { usePreview } from '@/lib/preview';

import { asFailure, call, type CurrentSetting, type Failure } from './api';
import { IdentitySection } from './IdentitySection';
import { ReasonCodesSection } from './ReasonCodesSection';
import { SecuritySection } from './SecuritySection';
import { TermsSection } from './TermsSection';

type Tab = 'identity' | 'terms' | 'security' | 'moderation';

const TABS: { key: Tab; label: string }[] = [
  { key: 'identity', label: 'Identity and help' },
  { key: 'terms', label: 'Terms and data' },
  { key: 'security', label: 'Security and operations' },
  { key: 'moderation', label: 'Moderation reason codes' },
];

/**
 * SETTINGS, PHASE 1 (2026-10-25). CORWADO's "Settings" tab: service
 * configuration, policy versions, security, integration and recovery
 * controls. Administrators holding Manage settings (settings.manage); every
 * route behind this answers 403 to anyone else, and then this says so.
 *
 * Every save is a new version -- nothing is overwritten -- and an audit row.
 * Secrets are never shown: integrations appear as "set" or "missing" by the
 * name of the variable.
 *
 * Phase 2 adds language and region, registration and recovery, profile
 * privacy defaults, marketplace reference lists and notification templates
 * (docs/DECISIONS.md).
 */
export function SettingsAdmin() {
  const { role, hydrated } = usePreview();
  const isAdmin = hydrated && role === 'admin';
  const [tab, setTab] = useState<Tab>('identity');
  const [settings, setSettings] = useState<CurrentSetting[] | null>(null);
  const [failure, setFailure] = useState<Failure | null>(null);

  const load = useCallback(async () => {
    setFailure(null);
    try {
      setSettings(await call<CurrentSetting[]>('/api/admin/settings'));
    } catch (e) {
      setFailure(asFailure(e));
    }
  }, []);

  useEffect(() => {
    if (isAdmin) void load();
  }, [isAdmin, load]);

  const replace = (fresh: CurrentSetting) =>
    setSettings((all) => (all ?? []).map((s) => (s.key === fresh.key ? fresh : s)));

  const get = <K extends SettingKey>(key: K) =>
    settings?.find((s) => s.key === key) as CurrentSetting<K> | undefined;

  if (!isAdmin || failure?.status === 403) {
    return (
      <Notice kind="info" title="Administrators only">
        <p className="small">Settings are managed by administrators who hold Manage settings.</p>
      </Notice>
    );
  }

  const identity = get('identity');
  const support = get('support');
  const maintenance = get('maintenance');
  const reasonCodes = get('reason_codes');

  return (
    <section style={{ display: 'grid', gap: 'var(--s-4)' }}>
      <PageHeader
        title="Settings"
        subtitle="Service configuration, policy versions, security, integrations and recovery. Every change is kept as a new version and recorded in the audit trail."
      />
      <Tabs label="Settings section" items={TABS} value={tab} onChange={setTab} />
      {failure ? (
        <Notice kind="error" title="Settings could not be loaded">
          <p className="small">{failure.message}</p>
          <Button size="small" variant="secondary" onClick={() => void load()}>
            Try again
          </Button>
        </Notice>
      ) : null}
      {settings === null && !failure ? <p className="muted">Loading…</p> : null}

      {tab === 'identity' && identity && support ? (
        <IdentitySection identity={identity} support={support} onSaved={replace} />
      ) : null}
      {tab === 'terms' ? <TermsSection /> : null}
      {tab === 'security' && maintenance ? (
        <SecuritySection maintenance={maintenance} onSaved={replace} />
      ) : null}
      {tab === 'moderation' && reasonCodes ? (
        <ReasonCodesSection setting={reasonCodes} onSaved={replace} />
      ) : null}
    </section>
  );
}
