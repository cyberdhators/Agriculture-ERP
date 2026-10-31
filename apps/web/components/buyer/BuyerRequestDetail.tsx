'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';

import { buyerMayCancelRequest, type PurchaseRequestStatus } from '@agri-erp/shared';

import { BuyerApiError, getRequest, patchRequest, type PurchaseRequest } from '@/lib/buyer/api';
import { REQUEST_STATUS_STAMPS, categoryLabelOf, stampOf } from '@/lib/buyer/labels';
import { formatDate, formatPhone } from '@/lib/format';
import { t } from '@/lib/i18n';

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
import { MessageButton } from '../messages/MessageButton';
import { LoadingState } from '../ui/data';
import { ConfirmationDialog, useToast } from '../ui/feedback';
import { useBuyer } from './BuyerShell';
import { quantityIn, requestStatusIn } from './Timeline';
import styles from './buyer.module.css';
import { DirArrow } from '@/components/ui/icons';

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
  const { profile, language } = useBuyer();
  const w = (key: Parameters<typeof t>[0]) => t(key, language);
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
        title: w(action === 'submit' ? 'buyer.request.sentToast' : 'buyer.request.cancelled'),
      });
    } catch (e) {
      setFailure(e instanceof Error ? e.message : w('buyer.request.notSaved'));
    } finally {
      setBusy(false);
    }
  };

  if (state === 'loading') return <LoadingState rows={5} label={w('buyer.common.loading')} />;
  if (state !== 'ready' || !request) {
    return (
      <EmptyState
        error={state === 'error'}
        title={w(state === 'missing' ? 'buyer.request.notFound' : 'buyer.request.loadFailed')}
        body={w('buyer.w.notFoundBody')}
        actions={<Link href="/buyer/purchase-requests">{w('buyer.request.back')}</Link>}
      />
    );
  }

  const status = request.status as PurchaseRequestStatus;
  const canCancel = buyerMayCancelRequest(status);
  const canSend = status === 'draft' && profile.verification.capabilities.request;
  const contactTitle = request.farmer_name
    ? w('buyer.request.contactName').replace('{name}', request.farmer_name)
    : w('buyer.w.contactFarmer');

  return (
    <div className={styles.page}>
      <Link href="/buyer/purchase-requests" className="small">
        <DirArrow back /> {w('buyer.nav.myRequests')}
      </Link>
      <PageHeader
        eyebrow={categoryLabelOf(request.category, language)}
        title={request.product_name}
        subtitle={
          <Stamp kind={stampOf(REQUEST_STATUS_STAMPS, request.status)}>
            {requestStatusIn(request.status, language)}
          </Stamp>
        }
        actions={
          <>
            {canSend ? (
              <Button disabled={busy} onClick={() => void act('submit')}>
                {w('buyer.request.send')}
              </Button>
            ) : null}
            {canCancel ? (
              <Button variant="secondary" disabled={busy} onClick={() => setConfirmCancel(true)}>
                {w('buyer.request.cancel')}
              </Button>
            ) : null}
          </>
        }
      />

      {status === 'draft' && !profile.verification.capabilities.request ? (
        <Notice kind="info" title={w('buyer.request.draftTitle')}>
          {w('buyer.request.draftBody')}
        </Notice>
      ) : null}
      {failure ? (
        <Notice kind="error" title={w('buyer.w.notSaved')}>
          {failure}
        </Notice>
      ) : null}
      {request.decision_note ? (
        <Notice
          kind={status === 'rejected' ? 'warn' : 'info'}
          title={w('buyer.request.farmerNote')}
        >
          {request.decision_note}
        </Notice>
      ) : null}

      {request.farmer_phone ? (
        <Card>
          <CardHeader title={contactTitle} subtitle={w('buyer.request.agreeDirectly')} />
          <CardBody>
            <div className={styles.actions}>
              <ButtonLink href={`tel:${request.farmer_phone}`}>
                {w('buyer.w.call')} <span dir="ltr">{formatPhone(request.farmer_phone)}</span>
              </ButtonLink>
              <ButtonLink
                variant="secondary"
                href={`https://wa.me/${request.farmer_phone.replace(/\D/g, '')}`}
              >
                {w('buyer.w.whatsapp')}
              </ButtonLink>
            </div>
          </CardBody>
        </Card>
      ) : request.listing_id && status !== 'draft' && status !== 'cancelled' ? (
        // 2026-10-20: the farmer keeps their phone private on this listing.
        <Card>
          <CardHeader title={contactTitle} subtitle={w('buyer.w.prefersMessages')} />
          <CardBody>
            <MessageButton postKind="listing" postId={request.listing_id} language={language} />
          </CardBody>
        </Card>
      ) : null}

      <Card>
        <CardHeader title={w('buyer.w.details')} />
        <CardBody>
          <DefinitionList
            items={[
              {
                term: w('buyer.w.quantity'),
                value: quantityIn(request.quantity, request.unit, language),
              },
              { term: w('buyer.w.deliverTo'), value: request.delivery_location },
              {
                term: w('buyer.w.neededBy'),
                value: request.required_by ?? w('buyer.request.noDate'),
              },
              { term: w('buyer.w.notes'), value: request.notes ?? '—' },
              {
                term: w('buyer.request.fromListing'),
                value: request.listing_id ? (
                  <Link href={`/buyer/marketplace/${request.listing_id}`}>
                    {request.listing_title ?? w('buyer.request.openListing')}
                  </Link>
                ) : (
                  w('buyer.request.noListing')
                ),
              },
              { term: w('buyer.request.raisedBy'), value: request.created_by_name },
              { term: w('buyer.request.raised'), value: formatDate(request.created_at, language) },
              {
                term: w('buyer.request.sent'),
                value: request.submitted_at
                  ? formatDate(request.submitted_at, language)
                  : w('buyer.request.notYetSent'),
              },
              {
                term: w('buyer.request.answered'),
                value: request.decided_at
                  ? formatDate(request.decided_at, language)
                  : w('buyer.request.notYet'),
              },
            ]}
          />
        </CardBody>
      </Card>

      <ConfirmationDialog
        open={confirmCancel}
        onCancel={() => setConfirmCancel(false)}
        onConfirm={() => void act('cancel')}
        title={w('buyer.request.confirmTitle')}
        consequence={w('buyer.request.confirmBody')}
        confirmLabel={w('buyer.request.cancel')}
        destructive
        busy={busy}
      />
    </div>
  );
}
