'use client';

import Link from 'next/link';
import { useState } from 'react';

import { REPORT_REASONS } from '@agri-erp/shared';

import { Button, Dialog, Field, Notice, Select, Textarea } from '@/components/ui';
import { t, type Language, type TKey } from '@/lib/i18n';
import {
  MarketPostError,
  getContact,
  reportPost,
  type PostKind,
  type ReportTarget,
} from '@/lib/market-posts/api';

import styles from './market-posts.module.css';

const REASON_KEY: Record<(typeof REPORT_REASONS)[number], TKey> = {
  prohibited_content: 'report.prohibited_content',
  misleading_listing: 'report.misleading_listing',
  counterfeit_or_fraud: 'report.counterfeit_or_fraud',
  inappropriate_content: 'report.inappropriate_content',
  duplicate_or_spam: 'report.duplicate_or_spam',
  other: 'report.other',
};

/**
 * LISTINGS LANE (2026-10-19). The poster's phone, revealed on request to a
 * signed-in farmer or buyer -- never printed on the public page. A visitor
 * who is not signed in is told how to get it.
 */
export function ContactReveal({ kind, id, lang }: { kind: PostKind; id: string; lang: Language }) {
  const [state, setState] = useState<
    | { kind: 'idle' }
    | { kind: 'busy' }
    | { kind: 'shown'; name: string; phone: string }
    | { kind: 'private' }
    | { kind: 'signin' }
    | { kind: 'failed'; message: string }
  >({ kind: 'idle' });

  async function reveal() {
    setState({ kind: 'busy' });
    try {
      const c = await getContact(kind, id);
      // 2026-10-20: the poster may have turned their phone off since the page loaded.
      setState(
        c.contact_phone
          ? { kind: 'shown', name: c.display_name, phone: c.contact_phone }
          : { kind: 'private' },
      );
    } catch (e) {
      if (e instanceof MarketPostError && (e.status === 401 || e.status === 403)) {
        setState({ kind: 'signin' });
      } else {
        setState({ kind: 'failed', message: e instanceof Error ? e.message : String(e) });
      }
    }
  }

  return (
    <div className={styles.contactBox}>
      {state.kind === 'shown' ? (
        <>
          <span className="small muted" dir="auto">
            {state.name}
          </span>
          <a className={styles.phone} href={`tel:${state.phone}`}>
            {state.phone}
          </a>
          <div className={styles.actionRow}>
            <a href={`tel:${state.phone}`}>{t('posts.call', lang)}</a>
            <a href={`sms:${state.phone}`}>{t('posts.sms', lang)}</a>
          </div>
        </>
      ) : state.kind === 'private' ? (
        <p className="small muted">{t('posts.phonePrivate', lang)}</p>
      ) : (
        <Button onClick={() => void reveal()} disabled={state.kind === 'busy'}>
          {t('posts.showContact', lang)}
        </Button>
      )}
      {state.kind === 'signin' ? (
        <p className="small">
          {t('posts.signInForContact', lang)}{' '}
          <Link href="/farmer/login">{t('posts.farmerSignIn', lang)}</Link> ·{' '}
          <Link href="/login">{t('posts.buyerSignIn', lang)}</Link>
        </p>
      ) : null}
      {state.kind === 'failed' ? <p className={styles.error}>{state.message}</p> : null}
    </div>
  );
}

/**
 * LISTINGS LANE (2026-10-19). "Report this" for a buying request or a
 * service listing: the product-report mechanism, reused. A reason and,
 * optionally, a sentence; nothing about the person reporting is sent or kept.
 */
export function ReportPost({
  kind,
  id,
  lang,
  label,
}: {
  kind: ReportTarget;
  id: string;
  lang: Language;
  /** 2026-10-23: the button's words, e.g. "Report profile". */
  label?: string;
}) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('');
  const [description, setDescription] = useState('');
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);

  async function send() {
    setBusy(true);
    setFailure(null);
    try {
      await reportPost(kind, id, {
        reason,
        ...(description.trim() ? { description: description.trim() } : {}),
      });
      setDone(true);
      setOpen(false);
    } catch (e) {
      setFailure(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  if (done) {
    return (
      <Notice kind="success">
        <p className="small">{t('posts.reported', lang)}</p>
      </Notice>
    );
  }

  return (
    <>
      <Button variant="ghost" size="small" onClick={() => setOpen(true)}>
        {label ?? t('posts.report', lang)}
      </Button>
      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        title={t('posts.reportTitle', lang)}
        footer={
          <>
            <Button variant="ghost" onClick={() => setOpen(false)}>
              {t('lifecycle.cancel', lang)}
            </Button>
            <Button disabled={busy || reason === ''} onClick={() => void send()}>
              {t('posts.reportSend', lang)}
            </Button>
          </>
        }
      >
        <Field label={t('posts.reportReason', lang)}>
          {(ids) => (
            <Select {...ids} value={reason} onChange={(e) => setReason(e.target.value)}>
              <option value="">{t('register.select', lang)}</option>
              {REPORT_REASONS.map((r) => (
                <option key={r} value={r}>
                  {t(REASON_KEY[r], lang)}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field label={t('posts.reportDetail', lang)} optional>
          {(ids) => (
            <Textarea
              {...ids}
              rows={3}
              maxLength={500}
              dir="auto"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          )}
        </Field>
        <p className="small muted">{t('posts.reportPrivacy', lang)}</p>
        {failure ? <p className={styles.error}>{failure}</p> : null}
      </Dialog>
    </>
  );
}
