'use client';

import { useEffect, useState } from 'react';

import { Button, Checkbox, Field, Notice, PasswordInput } from '@/components/ui';
import { clearCacheFor } from '@/lib/offline/db';
import { currentAccount, ensureAccount, setAccount } from '@/lib/offline/outbox';
import { supabaseBrowser } from '@/lib/supabase/browser';

import css from './settings.module.css';

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
    orgs: 'You are the only administrator of these organisations. Hand administration to a colleague first (Organisations), or close them with your account: their posts are taken off the market, their conversations closed and everyone’s access ended. Their records are kept.',
    closeOrgs: 'Close these organisations with my account.',
    orgsLeave:
      'Where someone else is an administrator, you simply leave the organisation; it carries on without you.',
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
    orgs: 'أنت المسؤول الوحيد عن هذه المنظمات. سلّم الإدارة لزميل أولاً (المنظمات)، أو أغلقها مع حسابك: تُسحب منشوراتها من السوق وتُغلق محادثاتها وينتهي وصول الجميع. تُحفظ سجلاتها.',
    closeOrgs: 'أغلق هذه المنظمات مع حسابي.',
    orgsLeave: 'حيث يوجد مسؤول آخر، تغادر المنظمة فقط وتستمر من دونك.',
  },
} satisfies Record<Lang, Record<string, string>>;

/**
 * "Delete my account" (2026-10-20): POST /api/account/delete with the
 * account's password and an explicit yes. On success the phone forgets the
 * account -- the session and everything saved offline -- and goes home.
 */
export function DeleteAccount({
  language = 'en',
  variant = 'card',
}: {
  language?: Lang;
  /** 2026-10-31: 'row' is one red settings row that opens the warning and the form. */
  variant?: 'card' | 'row';
}) {
  const w = W[language];
  const [open, setOpen] = useState(false);
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fields, setFields] = useState<Record<string, string>>({});
  // 2026-10-27 (team access): organisations this person is the last administrator of.
  const [soleOrgs, setSoleOrgs] = useState<{ id: string; name: string }[]>([]);
  const [hasOrgs, setHasOrgs] = useState(false);
  const [closeOrgs, setCloseOrgs] = useState(false);

  useEffect(() => {
    if (!open) return;
    void fetch('/api/organizations', { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : null))
      .then((b: { data?: { id: string; name: string; sole_administrator?: boolean }[] } | null) => {
        const list = b?.data ?? [];
        setHasOrgs(list.length > 0);
        setSoleOrgs(list.filter((o) => o.sole_administrator));
      })
      .catch(() => undefined);
  }, [open]);

  async function remove(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    setFields({});
    try {
      const response = await fetch('/api/account/delete', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          password,
          confirm,
          ...(soleOrgs.length > 0 ? { close_organizations: closeOrgs } : {}),
        }),
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

  const form = (
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
      {soleOrgs.length > 0 ? (
        <Notice kind="warn">
          <p className="small">{w.orgs}</p>
          <ul className="small">
            {soleOrgs.map((o) => (
              <li key={o.id} dir="auto">
                {o.name}
              </li>
            ))}
          </ul>
          <Checkbox
            label={w.closeOrgs}
            checked={closeOrgs}
            onChange={(e) => setCloseOrgs(e.target.checked)}
          />
        </Notice>
      ) : null}
      {hasOrgs ? (
        <p className="small muted" style={{ margin: 0 }}>
          {w.orgsLeave}
        </p>
      ) : null}
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
        <Button
          type="submit"
          variant="danger"
          disabled={busy || !confirm || !password || (soleOrgs.length > 0 && !closeOrgs)}
        >
          {busy ? w.deleting : w.delete}
        </Button>
        <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
          {w.cancel}
        </Button>
      </div>
    </form>
  );

  if (variant === 'row') {
    return (
      <li>
        <button
          type="button"
          className={`${css.row} ${css.rowButton} ${css.danger}`}
          aria-expanded={open}
          onClick={() => setOpen((v) => !v)}
        >
          <span className={css.rowIcon} aria-hidden>
            <svg
              viewBox="0 0 24 24"
              width="20"
              height="20"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3" />
            </svg>
          </span>
          <span className={css.rowText}>
            <span className={css.rowLabel}>{w.title}</span>
          </span>
        </button>
        {open ? (
          <div className={css.panel}>
            <p className="small muted" style={{ margin: 0 }}>
              {w.lead}
            </p>
            {form}
          </div>
        ) : null}
      </li>
    );
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
        form
      )}
    </section>
  );
}
