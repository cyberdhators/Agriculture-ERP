'use client';

import { useState } from 'react';

import { Badge, Card, CardBody, EmptyState, Tabs } from '@/components/ui';
import { useFarmerSession } from '@/lib/farmer-session';
import type { DirectoryEntryRow } from '@/lib/fixtures/p1';
import { formatPhone } from '@/lib/format';
import { t, type Language } from '@/lib/i18n';

import { PageHead } from './AccountShell';
import styles from './farmer.module.css';

const ENTRY_TYPES = ['all', 'agro_dealer', 'input_supplier', 'financial_service'] as const;
type FilterType = (typeof ENTRY_TYPES)[number];

const TYPE_LABEL = {
  agro_dealer: 'services.agroDealer' as const,
  input_supplier: 'services.inputSupplier' as const,
  financial_service: 'services.financialService' as const,
};

const TYPE_TONE: Record<string, 'leaf' | 'sorghum' | 'nile'> = {
  agro_dealer: 'leaf',
  input_supplier: 'sorghum',
  financial_service: 'nile',
};

export function FarmerServices() {
  const { farmer, language } = useFarmerSession();
  const [filter, setFilter] = useState<FilterType>('all');

  if (!farmer) return null;

  // Directory entries will come from the directory API (deliverable (h))
  // once it is wired to the farmer view. Until then, empty state.
  const active: DirectoryEntryRow[] = [];
  const entries = filter === 'all' ? active : active.filter((e) => e.entry_type === filter);

  const tabs = ENTRY_TYPES.map((type) => ({
    key: type,
    label: type === 'all' ? t('services.allTypes', language) : t(TYPE_LABEL[type], language),
    count: type === 'all' ? active.length : active.filter((e) => e.entry_type === type).length,
  }));

  return (
    <>
      <PageHead title={t('services.title', language)} lead={t('services.lead', language)} />

      <Tabs
        label={t('services.title', language)}
        items={tabs}
        value={filter}
        onChange={setFilter}
      />

      {entries.length === 0 ? (
        <EmptyState title={t('services.empty', language)} body={t('services.lead', language)} />
      ) : (
        <div className={styles.serviceGrid}>
          {entries.map((entry) => (
            <ServiceCard key={entry.id} entry={entry} language={language} />
          ))}
        </div>
      )}
    </>
  );
}

function ServiceCard({ entry, language }: { entry: DirectoryEntryRow; language: Language }) {
  const typeKey = TYPE_LABEL[entry.entry_type as keyof typeof TYPE_LABEL];

  return (
    <Card>
      <CardBody>
        <div className={styles.serviceHead}>
          <Badge tone={TYPE_TONE[entry.entry_type] ?? 'neutral'}>
            {typeKey ? t(typeKey, language) : entry.entry_type}
          </Badge>
          <h3>{entry.name}</h3>
        </div>
        {entry.description ? (
          <p className="small" style={{ color: 'var(--ink-2)', marginTop: 'var(--s-2)' }}>
            {entry.description}
          </p>
        ) : null}
        {entry.services.length > 0 ? (
          <div className={styles.serviceChips}>
            {entry.services.map((s) => (
              <span key={s} className={styles.serviceChip}>
                {s}
              </span>
            ))}
          </div>
        ) : null}
        <dl className={styles.serviceDl}>
          {entry.contact_name ? (
            <>
              <dt>{t('services.contact', language)}</dt>
              <dd>{entry.contact_name}</dd>
            </>
          ) : null}
          <dt>{t('account.phone', language)}</dt>
          <dd className="mono">{formatPhone(entry.phone)}</dd>
          {entry.physical_address ? (
            <>
              <dt>{t('services.address', language)}</dt>
              <dd>{entry.physical_address}</dd>
            </>
          ) : null}
          <dt>{t('services.verified', language)}</dt>
          <dd className="mono">{entry.last_verified_at}</dd>
        </dl>
      </CardBody>
    </Card>
  );
}
