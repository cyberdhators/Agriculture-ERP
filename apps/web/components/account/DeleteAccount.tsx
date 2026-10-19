'use client';

import { useState } from 'react';

import { Button, Checkbox, Field, Notice, PasswordInput } from '@/components/ui';
import { clearCacheFor } from '@/lib/offline/db';
import { currentAccount, ensureAccount, setAccount } from '@/lib/offline/outbox';
import { supabaseBrowser } from '@/lib/supabase/browser';

type Lang = 'en' | 'ar';

const W = {
  en: {
    title: 'Delete my account',
    lead: 'Your listings, buying requests and services are taken off the market, your conversations are closed and show you as "Former member", and you are signed out on every phone. CORWADO keeps the record for its audit, but nobody else sees it. This cannot be undone from the app.',
    open: 'Delete my account…',
    password: 'Your password',
    confirm: 'I understand. Delete my account.',
    delete: 'Delete my account',
    deleting: 'Deleting…',
    cancel: 'Cancel',
    done: 'Your account has been deleted.',
    failed: 'The account was not deleted. Please try again.',
  },
  ar: {
    title: 'حذف حسابي',
    lead: 'تُسحب معروضاتك وطلبات الشراء والخدمات من السوق، وتُغلق محادثاتك ويظهر اسمك فيها «عضو سابق»، ويتم تسجيل خروجك من كل الهواتف. يحتفظ كوروادو بالسجل للتدقيق، لكن لا يراه أحد غيره. لا يمكن التراجع عن ذلك من التطبيق.',
    open: 'حذف حسابي…',
    password: 'كلمة المرور',
    confirm: 'أفهم ذلك. احذف حسابي.',
    delete: 'حذف حسابي',
    deleting: 'جارٍ الحذف…',
    cancel: 'إلغاء',
    done: 'تم حذف حسابك.',
    failed: 'لم يتم حذف الحساب. حاول مرة أخرى.',
  },
} satisfies Record<Lang, Record<string, string>>;

/**
 * "Delete my account" (2026-10-20): POST /api/account/delete with the
 * account's password and an explicit yes. On success the phone forgets the
 * account -- the session and everything saved offline -- and goes home.
 */
export function DeleteAccount({ language = 'en' }: { language?: Lang }) {
  const w = W[language];
  const [open, setOpen] = useState(false);
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fields, setFields] = useState<Record<string, string>>({});

  async function remove(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    setFields({});
    try {
      const response = await fetch('/api/account/delete', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ password, confirm }),
      });
      if (!response.ok) {
        const body = (await response.json().catch(() => ({}))) as {
          error?: { message?: string; fields?: Record<string, string> };
        };
        setFields(body.error?.fields ?? {});
        setError(body.error?.fields ? null : (body.error?.message ?? w.failed));
        return;
      }
      // Forget the account on this phone: saved pages and data, then the session.
      const id = currentAccount() ?? (await ensureAccount());
      if (id) await clearCacheFor(id).catch(() => undefined);
      setAccount(null);
      await supabaseBrowser()
        .auth.signOut({ scope: 'local' })
        .catch(() => undefined);
      window.location.assign('/');
    } catch {
      setError(w.failed);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <h2 style={{ margin: 0 }}>{w.title}</h2>
      <p className="small muted" style={{ margin: 0 }}>
        {w.lead}
      </p>
      {!open ? (
        <div>
          <Button variant="danger" onClick={() => setOpen(true)}>
            {w.open}
          </Button>
        </div>
      ) : (
        <form
          onSubmit={(e) => void remove(e)}
          style={{ display: 'flex', flexDirection: 'column', gap: 12 }}
        >
          <Field label={w.password} error={fields.password}>
            {(ids) => (
              <PasswordInput
                {...ids}
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            )}
          </Field>
          <Checkbox
            label={w.confirm}
            checked={confirm}
            onChange={(e) => setConfirm(e.target.checked)}
          />
          {fields.confirm ? (
            <p className="small" role="alert">
              {fields.confirm}
            </p>
          ) : null}
          {error ? <Notice kind="error">{error}</Notice> : null}
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <Button type="submit" variant="danger" disabled={busy || !confirm || !password}>
              {busy ? w.deleting : w.delete}
            </Button>
            <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
              {w.cancel}
            </Button>
          </div>
        </form>
      )}
    </section>
  );
}
