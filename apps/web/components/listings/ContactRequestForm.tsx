'use client';

import { useState, type FormEvent } from 'react';

import { Button, Dialog, Field, Input, Notice, Textarea } from '@/components/ui';
import { createContactRequest } from '@/lib/contact/api';
import { validateContactRequest, type ContactRequestErrors } from '@/lib/contact/validate';
import type { ProduceListing } from '@/lib/fixtures/farmers';
import { t, type Language } from '@/lib/i18n';

/**
 * How a buyer reaches a farmer (deliverable (g)). No account: the buyer gives
 * a name, a phone and what they want; the request goes to the farmer's
 * extension officer, who calls both sides and records the introduction. The
 * farmer's number never leaves the programme (scope, "The marketplace
 * amendment", option 2). Off live the request sits in this browser's preview
 * store so the officer desk and the farmer's Home can show it.
 */
export function ContactRequestForm({
  listing,
  lang,
  open,
  onClose,
}: {
  listing: ProduceListing;
  lang: Language;
  open: boolean;
  onClose: () => void;
}) {
  const [values, setValues] = useState({
    buyer_name: '',
    buyer_phone: '',
    message: '',
    quantity: '',
  });
  const [errors, setErrors] = useState<ContactRequestErrors>({});
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [failed, setFailed] = useState<string | null>(null);

  function set<K extends keyof typeof values>(k: K, v: string) {
    setValues((s) => ({ ...s, [k]: v }));
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    setFailed(null);
    const r = validateContactRequest(values);
    if (!r.ok) {
      setErrors(r.errors);
      return;
    }
    setErrors({});
    setBusy(true);
    try {
      await createContactRequest(listing.id, r.body);
      setDone(true);
    } catch (err) {
      setFailed(err instanceof Error ? err.message : t('contact.failed', lang));
    } finally {
      setBusy(false);
    }
  }

  function close() {
    onClose();
    if (done) {
      setDone(false);
      setValues({ buyer_name: '', buyer_phone: '', message: '', quantity: '' });
    }
  }

  return (
    <Dialog
      open={open}
      onClose={close}
      title={t('contact.title', lang)}
      footer={
        done ? (
          <Button variant="primary" onClick={close}>
            {t('contact.close', lang)}
          </Button>
        ) : (
          <>
            <Button variant="ghost" onClick={close}>
              {t('contact.cancel', lang)}
            </Button>
            <Button variant="primary" type="submit" form="contact-request-form" disabled={busy}>
              {busy ? t('contact.sending', lang) : t('contact.send', lang)}
            </Button>
          </>
        )
      }
    >
      {done ? (
        <Notice kind="success" title={t('contact.sentTitle', lang)}>
          <p className="small">{t('contact.sentBody', lang)}</p>
        </Notice>
      ) : (
        <form id="contact-request-form" onSubmit={submit} noValidate>
          <p className="small" dir="auto">
            {t('contact.lead', lang)} <strong>{listing.title}</strong>
          </p>
          {failed ? (
            <Notice kind="error" title={t('contact.failedTitle', lang)}>
              <p className="small">{failed}</p>
            </Notice>
          ) : null}
          <Field label={t('contact.name', lang)} error={errors.buyer_name}>
            {(ids) => (
              <Input
                {...ids}
                autoComplete="name"
                value={values.buyer_name}
                onChange={(e) => set('buyer_name', e.target.value)}
              />
            )}
          </Field>
          <Field
            label={t('contact.phone', lang)}
            hint={t('contact.phoneHint', lang)}
            error={errors.buyer_phone}
          >
            {(ids) => (
              <Input
                {...ids}
                inputMode="tel"
                autoComplete="tel"
                value={values.buyer_phone}
                onChange={(e) => set('buyer_phone', e.target.value)}
              />
            )}
          </Field>
          <Field
            label={t('contact.quantity', lang)}
            hint={t('contact.quantityHint', lang)}
            error={errors.quantity}
          >
            {(ids) => (
              <Input
                {...ids}
                value={values.quantity}
                onChange={(e) => set('quantity', e.target.value)}
              />
            )}
          </Field>
          <Field label={t('contact.message', lang)} error={errors.message}>
            {(ids) => (
              <Textarea
                {...ids}
                rows={3}
                value={values.message}
                onChange={(e) => set('message', e.target.value)}
              />
            )}
          </Field>
          <p className="small muted">{t('contact.privacy', lang)}</p>
        </form>
      )}
    </Dialog>
  );
}
