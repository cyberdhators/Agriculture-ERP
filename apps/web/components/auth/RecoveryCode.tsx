'use client';

import { useState } from 'react';

import { Button, Notice } from '../ui';

/**
 * A recovery code, shown ONCE (2026-10-09). The system keeps only a scrambled
 * copy, so if the person does not write it down now, nobody can show it again
 * -- they can only get a new one while signed in.
 */
export function RecoveryCodeShown({
  code,
  language = 'en',
}: {
  code: string;
  language?: 'en' | 'ar';
}) {
  const [copied, setCopied] = useState(false);
  const ar = language === 'ar';
  return (
    <Notice
      kind="warn"
      title={ar ? 'رمز الاسترداد الخاص بك — اكتبه الآن' : 'Your recovery code — write it down now'}
    >
      <p
        className="mono"
        dir="ltr"
        style={{
          fontSize: '1.6rem',
          letterSpacing: '0.12em',
          fontWeight: 700,
          margin: 'var(--s-2) 0',
          userSelect: 'all',
        }}
      >
        {code}
      </p>
      <p className="small">
        {ar
          ? 'إذا نسيت كلمة المرور، يمكنك تعيين كلمة جديدة بهذا الرمز. لن نعرضه مرة أخرى. احتفظ به في مكان آمن ولا تشاركه مع أحد.'
          : 'If you forget your password, this code lets you set a new one. It will not be shown again. Keep it somewhere safe, and never share it.'}
      </p>
      <Button
        variant="secondary"
        size="small"
        onClick={() => {
          void navigator.clipboard
            ?.writeText(code)
            .then(() => setCopied(true))
            .catch(() => undefined);
        }}
      >
        {copied ? (ar ? 'تم النسخ' : 'Copied') : ar ? 'نسخ الرمز' : 'Copy code'}
      </Button>
    </Notice>
  );
}

/**
 * "Get a new recovery code", for a signed-in farmer or buyer: an account made
 * before codes existed, or one whose code was lost. The old code stops working.
 */
export function NewRecoveryCode({ language = 'en' }: { language?: 'en' | 'ar' }) {
  const ar = language === 'ar';
  const [code, setCode] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function issue() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/account/recovery-code', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: '{}',
      });
      const body = (await res.json().catch(() => ({}))) as {
        data?: { recovery_code: string };
        error?: { message?: string };
      };
      if (!res.ok || !body.data) {
        setError(body.error?.message ?? (ar ? 'لم يتم إنشاء رمز.' : 'No code was made.'));
        return;
      }
      setCode(body.data.recovery_code);
    } catch {
      setError(ar ? 'تعذر الوصول إلى الخادم.' : 'The server could not be reached.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ display: 'grid', gap: 'var(--s-3)' }}>
      <p className="small muted">
        {ar
          ? 'رمز الاسترداد يتيح لك تعيين كلمة مرور جديدة إذا نسيتها. الحصول على رمز جديد يُبطل الرمز القديم.'
          : 'A recovery code lets you set a new password if you forget it. Getting a new code makes your old one stop working.'}
      </p>
      {code ? <RecoveryCodeShown code={code} language={language} /> : null}
      {error ? (
        <Notice kind="error" title={ar ? 'لم يتم' : 'Not done'}>
          <p className="small">{error}</p>
        </Notice>
      ) : null}
      {code ? null : (
        <Button variant="secondary" disabled={busy} onClick={() => void issue()}>
          {busy ? '…' : ar ? 'احصل على رمز استرداد جديد' : 'Get a new recovery code'}
        </Button>
      )}
    </div>
  );
}
