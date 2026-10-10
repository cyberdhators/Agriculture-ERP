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
import { formatDate, formatPhone } from '@/lib/format';

import {
  Button,
  ButtonLink,
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
 * request can be cancelled until the farmer answers. Once sent, the farmer's
 * phone is shown so the two can deal directly (B14), with the farmer's answer
 * and note.
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
        title: action === 'submit' ? 'Request sent to the farmer' : 'Request cancelled',
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
        actions={<Link href="/buyer/purchase-requests">Back to my requests</Link>}
      />
    );
  }

  const status = request.status as PurchaseRequestStatus;
  const canCancel = buyerMayCancelRequest(status);
  const canSend = status === 'draft' && profile.verification.capabilities.request;

  return (
    <div className={styles.page}>
      <Link href="/buyer/purchase-requests" className="small">
        ← My requests
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
                Send to the farmer
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
          You can send this once your business account has been approved.
        </Notice>
      ) : null}
      {failure ? (
        <Notice kind="error" title="Not saved">
          {failure}
        </Notice>
      ) : null}
      {request.decision_note ? (
        <Notice kind={status === 'rejected' ? 'warn' : 'info'} title="Note from the farmer">
          {request.decision_note}
        </Notice>
      ) : null}

      {request.farmer_phone ? (
        <Card>
          <CardHeader
            title={request.farmer_name ? `Contact ${request.farmer_name}` : 'Contact the farmer'}
            subtitle="Agree the price, quality and handover directly with the farmer."
          />
          <CardBody>
            <div className={styles.actions}>
              <ButtonLink href={`tel:${request.farmer_phone}`}>
                Call {formatPhone(request.farmer_phone)}
              </ButtonLink>
              <ButtonLink
                variant="secondary"
                href={`https://wa.me/${request.farmer_phone.replace(/\D/g, '')}`}
              >
                WhatsApp
              </ButtonLink>
            </div>
          </CardBody>
        </Card>
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
                term: 'Farmer answered',
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
        consequence="The farmer will no longer see it as open. A cancelled request cannot be sent again; add the product to your cart again if you change your mind."
        confirmLabel="Cancel request"
        destructive
        busy={busy}
      />
    </div>
  );
}
