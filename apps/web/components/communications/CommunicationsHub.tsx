'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';

import { ANNOUNCEMENT_SCOPE_LABELS, type StaffAnnouncement } from '@agri-erp/shared';

import { Badge, Button, Notice, PageHeader, Tabs } from '@/components/ui';
import { DataTable } from '@/components/ui/data';
import { formatDate } from '@/lib/format';
import { asFailure, listAnnouncements, type Failure } from '@/lib/communications/announcements';
import { usePreview } from '@/lib/preview';

import { AnnouncementComposer, CHANNEL_LABELS } from './AnnouncementComposer';
import { Communications } from './Communications';
import { TemplatesPanel } from './TemplatesPanel';

type Tab = 'announcements' | 'templates' | 'direct';

const TABS: { key: Tab; label: string }[] = [
  { key: 'announcements', label: 'Announcements' },
  { key: 'templates', label: 'Templates' },
  { key: 'direct', label: 'Direct message' },
];

const STATUS_TONE: Record<StaffAnnouncement['status'], 'sorghum' | 'nile' | 'leaf'> = {
  draft: 'sorghum',
  sending: 'nile',
  completed: 'leaf',
};

/**
 * COMMUNICATIONS (2026-10-27). CORWADO's specification: "Official
 * announcements, templates, recipient scope, preferences and delivery
 * records. Preview before sending; private conversations are not a broadcast
 * resource."
 *
 * Announcements reach accounts by scope; templates save texts; Direct
 * message is the earlier screen that writes to chosen staff by email and to
 * chosen farmers or officers by SMS, unchanged.
 */
export function CommunicationsHub() {
  const [tab, setTab] = useState<Tab>('announcements');
  return (
    <section style={{ display: 'grid', gap: 'var(--s-4)' }}>
      {tab !== 'direct' ? (
        <PageHeader
          title="Communications"
          subtitle="Official announcements to accounts, by scope, with a preview before sending and a delivery record afterwards. Each person's notification settings are respected."
        />
      ) : null}
      <Tabs label="Communications section" items={TABS} value={tab} onChange={setTab} />
      {tab === 'announcements' ? <AnnouncementsPanel /> : null}
      {tab === 'templates' ? <TemplatesPanel /> : null}
      {tab === 'direct' ? <Communications /> : null}
    </section>
  );
}

function AnnouncementsPanel() {
  const { role, hydrated } = usePreview();
  const isAdmin = hydrated && role === 'admin';
  const router = useRouter();
  const [rows, setRows] = useState<StaffAnnouncement[] | null>(null);
  const [failure, setFailure] = useState<Failure | null>(null);
  const [composing, setComposing] = useState(false);

  const load = useCallback(async () => {
    try {
      setRows(await listAnnouncements());
      setFailure(null);
    } catch (e) {
      setFailure(asFailure(e));
    }
  }, []);

  useEffect(() => {
    if (isAdmin) void load();
  }, [isAdmin, load]);

  if (!isAdmin || failure?.status === 403) {
    return (
      <Notice kind="info" title="Administrators only">
        <p className="small">
          Announcements are sent by administrators who hold Send official announcements.
        </p>
      </Notice>
    );
  }

  return (
    <div style={{ display: 'grid', gap: 'var(--s-4)' }}>
      {failure ? (
        <Notice kind="error" title="Announcements could not be loaded">
          <p className="small">{failure.message}</p>
          <Button size="small" variant="secondary" onClick={() => void load()}>
            Try again
          </Button>
        </Notice>
      ) : null}
      {composing ? (
        <AnnouncementComposer
          announcement={null}
          onCancel={() => setComposing(false)}
          onSaved={(a) => router.push(`/communications/announcements/${a.id}`)}
        />
      ) : (
        <div>
          <Button onClick={() => setComposing(true)}>New announcement</Button>
        </div>
      )}
      {rows === null && !failure ? <p className="muted">Loading…</p> : null}
      {rows ? (
        <DataTable
          caption="Announcements"
          columns={[
            {
              key: 'title',
              header: 'Title',
              rowHeader: true,
              render: (a: StaffAnnouncement) => (
                <Link href={`/communications/announcements/${a.id}`}>{a.title}</Link>
              ),
            },
            {
              key: 'status',
              header: 'Status',
              render: (a) => <Badge tone={STATUS_TONE[a.status]}>{a.status}</Badge>,
            },
            { key: 'scope', header: 'Who', render: (a) => ANNOUNCEMENT_SCOPE_LABELS[a.scope.kind] },
            {
              key: 'channels',
              header: 'Channels',
              render: (a) => a.channels.map((c) => CHANNEL_LABELS[c]).join(', '),
            },
            {
              key: 'recipients',
              header: 'Recipients',
              numeric: true,
              render: (a) => (a.recipient_count === null ? '—' : a.recipient_count),
            },
            {
              key: 'when',
              header: 'Sent',
              render: (a) => (a.sent_at ? formatDate(a.sent_at) : 'Not sent'),
            },
          ]}
          rows={rows}
          rowKey={(a) => a.id}
          empty={<p className="muted">No announcements yet.</p>}
        />
      ) : null}
    </div>
  );
}
