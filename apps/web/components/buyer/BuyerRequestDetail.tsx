'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';

import { buyerMayCancelRequest, type PurchaseRequestStatus } from '@agri-erp/shared';

import { BuyerApiError, getRequest, patchRequest, type PurchaseRequest } from '@/lib/buyer/api';
import {
  CATEGORY_LABELS,
  REQUEST_STATUS_LABELS,
  REQUEST_STATUS_STAMPS,
  formatQuantity,
  labelOf,
  stampOf,
} from '@/lib/buyer/labels';
import { formatDate } from '@/lib/format';

import {
  Button,
  Card,
  CardBody,
  CardHeader,
  DefinitionList,
  EmptyState,
  Notice,
  PageHeader,
  Stamp,
} from '../ui';
import { LoadingState } from '../ui/data';
import { ConfirmationDialog, useToast } from '../ui/feedback';
import { useBuyer } from './BuyerShell';
import styles from './buyer.module.css';

/**
 * ONE PURCHASE REQUEST (C-14B.11). A draft can be sent or cancelled; a sent
 * request can be cancelled until a reviewer acts on it; after that it is
 * CORWADO's, and this page shows their decision and note.
 *
 * Another organisation's request answers 404 at the route, and this page says
 * "not found" -- the same words as an id that never existed.
 */
export function BuyerRequestDetail({ id }: { id: string }) {
  const toast = useToast();
  const { profile } = useBuyer();
  const [request, setRequest] = useState<PurchaseRequest | null>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'missing' | 'error'>('loading');
  const [busy, setBusy] = useState(false);
  const [confirmCancel, setConfirmCancel] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);

  const load = useCallback(() => {
    getRequest(id)
      .then((r) => {
        setRequest(r);
        setState('ready');
      })
      .catch((e: unknown) =>
        setState(e instanceof BuyerApiError && e.status === 404 ? 'missing' : 'error'),
      );
  }, [id]);

  useEffect(load, [load]);

  const act = async (action: 'submit' | 'cancel') => {
    setBusy(true);
    setFailure(null);
    try {
      const updated = await patchRequest(id, { action });
      setRequest(updated);
      setConfirmCancel(false);
      toast.show({
        kind: 'success',
        title: action === 'submit' ? 'Request sent to CORWADO' : 'Request cancelled',
      });
    } catch (e) {
      setFailure(e instanceof Error ? e.message : 'The change was not saved.');
    } finally {
      setBusy(false);
    }
  };

  if (state === 'loading') return <LoadingState rows={5} />;
  if (state !== 'ready' || !request) {
    return (
      <EmptyState
        error={state === 'error'}
        title={state === 'missing' ? 'Request not found' : 'The request could not be loaded'}
        body="It may belong to another organisation, or not exist."
        actions={<Link href="/buyer/purchase-requests">Back to purchase requests</Link>}
      />
    );
  }

  const status = request.status as PurchaseRequestStatus;
  const canCancel = buyerMayCancelRequest(status);
  const canSend = status === 'draft' && profile.verification.capabilities.request;

  return (
    <div className={styles.page}>
      <Link href="/buyer/purchase-requests" className="small">
        ← Purchase requests
      </Link>
      <PageHeader
        eyebrow={labelOf(CATEGORY_LABELS, request.category)}
        title={request.product_name}
        subtitle={
          <Stamp kind={stampOf(REQUEST_STATUS_STAMPS, request.status)}>
            {labelOf(REQUEST_STATUS_LABELS, request.status)}
          </Stamp>
        }
        actions={
          <>
            {canSend ? (
              <Button disabled={busy} onClick={() => void act('submit')}>
                Send to CORWADO
              </Button>
            ) : null}
            {canCancel ? (
              <Button variant="secondary" disabled={busy} onClick={() => setConfirmCancel(true)}>
                Cancel request
              </Button>
            ) : null}
          </>
        }
      />

      {status === 'draft' && !profile.verification.capabilities.request ? (
        <Notice kind="info" title="Saved as a draft">
          You can send this once CORWADO has verified your organisation.
        </Notice>
      ) : null}
      {failure ? (
        <Notice kind="error" title="Not saved">
          {failure}
        </Notice>
      ) : null}
      {request.decision_note ? (
        <Notice kind={status === 'rejected' ? 'warn' : 'info'} title="Note from CORWADO">
          {request.decision_note}
        </Notice>
      ) : null}

      <Card>
        <CardHeader title="Request" />
        <CardBody>
          <DefinitionList
            items={[
              { term: 'Quantity', value: formatQuantity(request.quantity, request.unit) },
              { term: 'Deliver to', value: request.delivery_location },
              { term: 'Needed by', value: request.required_by ?? 'No date given' },
              { term: 'Notes', value: request.notes ?? '—' },
              {
                term: 'From the listing',
                value: request.listing_id ? (
                  <Link href={`/buyer/marketplace/${request.listing_id}`}>
                    {request.listing_title ?? 'Open listing'}
                  </Link>
                ) : (
                  'Not tied to a listing'
                ),
              },
              { term: 'Raised by', value: request.created_by_name },
              { term: 'Raised', value: formatDate(request.created_at) },
              {
                term: 'Sent',
                value: request.submitted_at ? formatDate(request.submitted_at) : 'Not yet sent',
              },
              {
                term: 'Decided',
                value: request.decided_at ? formatDate(request.decided_at) : 'Not yet',
              },
            ]}
          />
        </CardBody>
      </Card>

      <ConfirmationDialog
        open={confirmCancel}
        onCancel={() => setConfirmCancel(false)}
        onConfirm={() => void act('cancel')}
        title="Cancel this request?"
        consequence="CORWADO will stop looking for suppliers for it. A cancelled request cannot be sent again; raise a new one if you change your mind."
        confirmLabel="Cancel request"
        destructive
        busy={busy}
      />
    </div>
  );
}
