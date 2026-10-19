'use client';

import { useState } from 'react';

import { lifecycleActions, type LifecycleAction, type LifecycleStage } from '@agri-erp/shared';

import { Button, Checkbox, Dialog, Field, Input, Notice, Stamp } from '@/components/ui';
import { t, type Language } from '@/lib/i18n';
import {
  ACTION_KEY,
  CONFIRMED_ACTIONS,
  STAGE_EXPLAIN_KEY,
  STAGE_KEY,
  renewalDefault,
  stageStamp,
  todayLocal,
} from '@/lib/market-posts/presentation';

import styles from './market-posts.module.css';

/** What an action carries: a new date for renew, a quantity for a sale. */
export type ActionInput =
  | { action: Exclude<LifecycleAction, 'renew' | 'record_sale'> }
  | { action: 'renew'; date: string }
  | { action: 'record_sale'; quantity: number; close: boolean };

/**
 * LISTINGS LANE (2026-10-19). The owner's buttons for one post: publish,
 * pause, resume, renew, withdraw, complete and, for produce, record a sale --
 * only those that fit its stage. Renew asks for the new date (thirty days on
 * by default); a sale asks for the quantity; withdraw and complete ask first,
 * because both are final. The server checks every move again.
 */
export function LifecycleActions({
  stage,
  lang,
  onAction,
  sale,
  saleNeedsSignal = false,
  endLabel,
}: {
  stage: LifecycleStage;
  lang: Language;
  onAction: (input: ActionInput) => Promise<void>;
  /** Produce only: what is left, written with its unit. */
  sale?: { remaining: number; remainingLabel: string };
  /** A sale is never queued on the phone; say so when there is no signal. */
  saleNeedsSignal?: boolean;
  /** "Available until" or "Needed by", for the renew dialog. */
  endLabel: string;
}) {
  const actions = lifecycleActions(stage, { sales: Boolean(sale) });
  const [open, setOpen] = useState<LifecycleAction | null>(null);
  const [date, setDate] = useState(renewalDefault());
  const [quantity, setQuantity] = useState('');
  const [close, setClose] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run(input: ActionInput) {
    setBusy(true);
    setError(null);
    try {
      await onAction(input);
      setOpen(null);
      setQuantity('');
      setClose(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : t('lifecycle.failed', lang));
    } finally {
      setBusy(false);
    }
  }

  function press(action: LifecycleAction) {
    setError(null);
    if (action === 'renew') {
      setDate(renewalDefault());
      setOpen('renew');
    } else if (action === 'record_sale' || CONFIRMED_ACTIONS.has(action)) {
      setOpen(action);
    } else {
      void run({ action } as ActionInput);
    }
  }

  const saleQuantity = Number(quantity);
  const saleValid =
    quantity.trim() !== '' &&
    Number.isFinite(saleQuantity) &&
    saleQuantity > 0 &&
    (!sale || saleQuantity <= sale.remaining);

  return (
    <section className={styles.lifecycle} aria-label={t('lifecycle.title', lang)}>
      <div className={styles.lifecycleHead}>
        <span className="small muted">{t('lifecycle.title', lang)}</span>
        <Stamp kind={stageStamp(stage)}>{t(STAGE_KEY[stage], lang)}</Stamp>
      </div>
      <p className="small muted">{t(STAGE_EXPLAIN_KEY[stage], lang)}</p>
      {sale ? (
        <p className="small">
          {t('lifecycle.remaining', lang)} <strong className="mono">{sale.remainingLabel}</strong>
        </p>
      ) : null}
      {error && !open ? (
        <Notice kind="error">
          <p className="small">{error}</p>
        </Notice>
      ) : null}
      {actions.length > 0 ? (
        <div className={styles.actionRow}>
          {actions.map((action) => (
            <Button
              key={action}
              size="small"
              variant={
                action === 'withdraw'
                  ? 'danger'
                  : action === 'publish' || action === 'resume' || action === 'renew'
                    ? 'primary'
                    : 'secondary'
              }
              disabled={busy}
              onClick={() => press(action)}
            >
              {t(ACTION_KEY[action], lang)}
            </Button>
          ))}
        </div>
      ) : (
        <p className="small muted">{t('lifecycle.final', lang)}</p>
      )}

      <Dialog
        open={open === 'renew'}
        onClose={() => setOpen(null)}
        title={t('lifecycle.renewTitle', lang)}
        footer={
          <>
            <Button variant="ghost" onClick={() => setOpen(null)}>
              {t('lifecycle.cancel', lang)}
            </Button>
            <Button
              disabled={busy || date < todayLocal()}
              onClick={() => run({ action: 'renew', date })}
            >
              {t('lifecycle.renew', lang)}
            </Button>
          </>
        }
      >
        <Field label={endLabel} hint={t('lifecycle.renewHint', lang)}>
          {(ids) => (
            <Input
              {...ids}
              type="date"
              className="mono"
              min={todayLocal()}
              value={date}
              onChange={(e) => setDate(e.target.value)}
            />
          )}
        </Field>
        {error ? <p className={styles.error}>{error}</p> : null}
      </Dialog>

      <Dialog
        open={open === 'record_sale'}
        onClose={() => setOpen(null)}
        title={t('lifecycle.saleTitle', lang)}
        footer={
          <>
            <Button variant="ghost" onClick={() => setOpen(null)}>
              {t('lifecycle.cancel', lang)}
            </Button>
            <Button
              disabled={busy || !saleValid || saleNeedsSignal}
              onClick={() => run({ action: 'record_sale', quantity: saleQuantity, close })}
            >
              {t('lifecycle.recordSale', lang)}
            </Button>
          </>
        }
      >
        {saleNeedsSignal ? (
          <Notice kind="warn">
            <p className="small">{t('lifecycle.saleNeedsSignal', lang)}</p>
          </Notice>
        ) : null}
        <Field
          label={t('lifecycle.saleQuantity', lang)}
          hint={sale ? `${t('lifecycle.remaining', lang)} ${sale.remainingLabel}` : undefined}
        >
          {(ids) => (
            <Input
              {...ids}
              inputMode="decimal"
              className="mono"
              value={quantity}
              onChange={(e) => setQuantity(e.target.value.replace(/[^\d.]/g, ''))}
            />
          )}
        </Field>
        <Checkbox
          label={t('lifecycle.saleCloses', lang)}
          checked={close}
          onChange={(e) => setClose(e.target.checked)}
        />
        {error ? <p className={styles.error}>{error}</p> : null}
      </Dialog>

      <Dialog
        open={open === 'withdraw' || open === 'complete'}
        onClose={() => setOpen(null)}
        title={t(open === 'complete' ? 'lifecycle.completeTitle' : 'lifecycle.withdrawTitle', lang)}
        footer={
          <>
            <Button variant="ghost" onClick={() => setOpen(null)}>
              {t('lifecycle.cancel', lang)}
            </Button>
            <Button
              variant={open === 'withdraw' ? 'danger' : 'primary'}
              disabled={busy}
              onClick={() => open && run({ action: open } as ActionInput)}
            >
              {t(open === 'complete' ? 'lifecycle.complete' : 'lifecycle.withdraw', lang)}
            </Button>
          </>
        }
      >
        <p className="small">
          {t(open === 'complete' ? 'lifecycle.completeBody' : 'lifecycle.withdrawBody', lang)}
        </p>
        {error ? <p className={styles.error}>{error}</p> : null}
      </Dialog>
    </section>
  );
}
