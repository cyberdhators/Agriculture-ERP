'use client';

import { useState } from 'react';

import {
  BUYER_VERIFICATION_STATUSES,
  BUYER_VERIFICATION_TRANSITIONS,
  STANDINGS_FOR,
  type BuyerVerificationStatus,
} from '@agri-erp/shared';

import { adminDecideBuyer, adminListBuyers, type AdminBuyerOrganization } from '@/lib/buyer/api';
import {
  ACCOUNT_TYPE_LABELS,
  ORG_TYPE_LABELS,
  VERIFICATION_LABELS,
  VERIFICATION_STAMPS,
  labelOf,
} from '@/lib/buyer/labels';
import { formatDate } from '@/lib/format';

import { useCursorList } from '../buyer/useCursorList';
import { Button, EmptyState, Field, Notice, PageHeader, Stamp, Tabs, Textarea } from '../ui';
import { DataTable, LoadingState, Pagination } from '../ui/data';
import { ConfirmationDialog, useToast } from '../ui/feedback';

/**
 * BUYER ACCOUNT REVIEW (B13, C-14B.3). Administrator only, on the server.
 *
 * Oldest application first. Each row offers only the decisions the transition
 * table allows from its current standing, and each decision asks for a note,
 * which the buyer sees. The decision is audited and notifies the organisation.
 */

const ACTION_LABELS: Record<BuyerVerificationStatus, string> = {
  pending: 'Return to pending',
  under_review: 'Start review',
  verified: 'Verify',
  rejected: 'Reject',
  suspended: 'Suspend',
  not_required: 'Restore',
};

const CONSEQUENCES: Record<BuyerVerificationStatus, string> = {
  pending: '',
  not_required:
    'The individual buyer can browse and send requests again. Individuals need no review.',
  under_review: 'The organisation is told its application is being checked.',
  verified:
    'The organisation can send purchase requests and receive orders from now on. It is notified.',
  rejected:
    'The organisation loses access to the marketplace immediately. It keeps read access to its history and sees your note.',
  suspended:
    'The organisation loses access to the marketplace on its next request. Its history stays readable.',
};

export function BuyerReview() {
  const toast = useToast();
  const [status, setStatus] = useState<BuyerVerificationStatus>('pending');
  const list = useCursorList((cursor) => adminListBuyers(status, cursor), status);
  const [pending, setPending] = useState<{
    org: AdminBuyerOrganization;
    to: BuyerVerificationStatus;
  } | null>(null);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);

  const decide = async () => {
    if (!pending) return;
    setBusy(true);
    setFailure(null);
    try {
      await adminDecideBuyer(pending.org.id, pending.to, note.trim() || undefined);
      toast.show({
        kind: 'success',
        title: `${pending.org.name}: ${VERIFICATION_LABELS[pending.to].toLowerCase()}`,
      });
      setPending(null);
      setNote('');
      list.reload();
    } catch (e) {
      setFailure(e instanceof Error ? e.message : 'The decision was not saved.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--s-6)' }}>
      <PageHeader
        title="Buyer accounts"
        subtitle="Organisations that applied to buy produce. Verify before they can send requests."
      />
      <Tabs
        label="Standing"
        value={status}
        onChange={setStatus}
        items={BUYER_VERIFICATION_STATUSES.map((s) => ({ key: s, label: VERIFICATION_LABELS[s] }))}
      />
      {list.error ? (
        <EmptyState
          error
          title="Buyer accounts could not be loaded"
          body={list.error}
          actions={<Button onClick={list.reload}>Try again</Button>}
        />
      ) : list.loading ? (
        <LoadingState rows={5} />
      ) : (
        <>
          <DataTable<AdminBuyerOrganization>
            caption="Buyer organisations"
            rows={list.rows}
            rowKey={(o) => o.id}
            empty={
              <EmptyState
                title={`No organisations are ${VERIFICATION_LABELS[status].toLowerCase()}`}
                body="New applications arrive here as pending."
              />
            }
            columns={[
              {
                key: 'name',
                header: 'Organisation',
                rowHeader: true,
                render: (o) => (
                  <span dir="auto">
                    <strong>{o.name}</strong>
                    <br />
                    <span className="small muted">
                      {ACCOUNT_TYPE_LABELS[o.account_type]}
                      {o.account_type === 'business'
                        ? ` · ${labelOf(ORG_TYPE_LABELS, o.organization_type)}`
                        : ''}{' '}
                      · {o.country_code}
                      {o.city ? ` · ${o.city}` : ''}
                    </span>
                  </span>
                ),
              },
              {
                key: 'reg',
                header: 'Registration / tax',
                render: (o) =>
                  [o.registration_number, o.tax_id].filter(Boolean).join(' / ') || 'Not given',
              },
              {
                key: 'contact',
                header: 'Contact',
                render: (o) => (
                  <span dir="auto">
                    {o.contact.name ?? '—'}
                    <br />
                    <span className="small mono">
                      {[o.contact.email, o.contact.phone].filter(Boolean).join(' · ')}
                    </span>
                  </span>
                ),
              },
              {
                key: 'applied',
                header: 'Applied',
                nowrap: true,
                render: (o) => formatDate(o.created_at),
              },
              {
                key: 'status',
                header: 'Standing',
                render: (o) => (
                  <Stamp kind={VERIFICATION_STAMPS[o.verification_status]}>
                    {VERIFICATION_LABELS[o.verification_status]}
                  </Stamp>
                ),
              },
              {
                key: 'actions',
                header: 'Decide',
                printHidden: true,
                render: (o) => (
                  <div style={{ display: 'flex', gap: 'var(--s-2)', flexWrap: 'wrap' }}>
                    {BUYER_VERIFICATION_TRANSITIONS[o.verification_status]
                      .filter((to) => STANDINGS_FOR[o.account_type].includes(to))
                      .map((to) => (
                        <Button
                          key={to}
                          size="small"
                          variant={to === 'verified' ? 'primary' : 'secondary'}
                          onClick={() => {
                            setPending({ org: o, to });
                            setNote('');
                            setFailure(null);
                          }}
                        >
                          {ACTION_LABELS[to]}
                        </Button>
                      ))}
                  </div>
                ),
              },
            ]}
          />
          <Pagination
            shown={list.rows.length}
            hasMore={list.hasMore}
            onNext={list.goNext}
            onPrevious={list.goBack}
            canGoBack={list.canGoBack}
          />
        </>
      )}

      <ConfirmationDialog
        open={pending !== null}
        onCancel={() => setPending(null)}
        onConfirm={() => void decide()}
        title={pending ? `${ACTION_LABELS[pending.to]} ${pending.org.name}?` : ''}
        consequence={pending ? CONSEQUENCES[pending.to] : ''}
        confirmLabel={pending ? ACTION_LABELS[pending.to] : 'Confirm'}
        destructive={pending?.to === 'rejected' || pending?.to === 'suspended'}
        busy={busy}
      >
        {failure ? <Notice kind="error">{failure}</Notice> : null}
        <Field
          label="Note to the organisation"
          optional
          hint="Shown to the buyer. Up to 500 characters."
        >
          {(ids) => (
            <Textarea
              {...ids}
              rows={3}
              maxLength={500}
              value={note}
              onChange={(e) => setNote(e.target.value)}
            />
          )}
        </Field>
      </ConfirmationDialog>
    </div>
  );
}
