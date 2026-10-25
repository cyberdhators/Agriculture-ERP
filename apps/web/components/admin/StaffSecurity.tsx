'use client';

import { type StaffMfaStatus, totpCodeSchema } from '@agri-erp/shared';
import { useCallback, useEffect, useState } from 'react';

import { MfaCodeStep } from '@/components/auth/MfaCodeStep';
import { supabaseBrowser } from '@/lib/supabase/browser';

import { Button, Card, Field, Input, Notice, PageHeader } from '../ui';

/**
 * YOUR SIGN-IN SECURITY (2026-10-28, lane-security). Two-step sign-in for
 * staff with an authenticator app (TOTP, Supabase Auth MFA).
 *
 *   - Not set up: "Set up two-step sign-in" creates a factor in Supabase,
 *     shows its QR code and key, and asks for a first code. Supabase checks
 *     the code (the factor becomes verified and this session reaches the
 *     second level); then POST /api/staff/mfa confirms it on the server and
 *     records `staff.mfa_enrolled`.
 *   - Set up, but this session has not passed the code step: the code is
 *     asked, and the portal opens as normal afterwards.
 *   - Set up and verified: nothing to do. A lost phone is reset by a Super
 *     Admin (Staff and permissions).
 *
 * The portal sends an administrator here before anything else until it is
 * done (lib/preview.tsx); requireRole is what actually refuses.
 */

type Enrolment = { factorId: string; qr: string; secret: string };

const nextPath = (): string => {
  const raw = new URL(window.location.href).searchParams.get('next') ?? '/dashboard';
  // Same-site paths only.
  return raw.startsWith('/') && !raw.startsWith('//') ? raw : '/dashboard';
};

export function StaffSecurity() {
  const [status, setStatus] = useState<StaffMfaStatus | null>(null);
  const [loadError, setLoadError] = useState<string | undefined>();
  const [enrolment, setEnrolment] = useState<Enrolment | null>(null);
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | undefined>();
  const [busy, setBusy] = useState(false);
  const [justEnrolled, setJustEnrolled] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/staff/mfa', { cache: 'no-store' });
      const body = (await res.json().catch(() => ({}))) as {
        data?: StaffMfaStatus;
        error?: { message?: string };
      };
      if (!res.ok || !body.data) {
        setLoadError(body.error?.message ?? 'Your sign-in security could not be loaded.');
        return;
      }
      setStatus(body.data);
      setLoadError(undefined);
    } catch {
      setLoadError('The server could not be reached. Try again in a moment.');
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function start() {
    setBusy(true);
    setError(undefined);
    try {
      const auth = supabaseBrowser().auth;
      // An abandoned earlier attempt leaves an unverified factor; clear it.
      const existing = await auth.mfa.listFactors();
      for (const f of (existing.data?.all ?? []) as { id: string; status: string }[]) {
        if (f.status !== 'verified') await auth.mfa.unenroll({ factorId: f.id });
      }
      const { data, error: e } = await auth.mfa.enroll({
        factorType: 'totp',
        friendlyName: `AgriOne ${new Date().toISOString().slice(0, 10)}`,
      });
      if (e || !data) {
        setError('Two-step sign-in could not be started. Try again in a moment.');
        return;
      }
      setEnrolment({ factorId: data.id, qr: data.totp.qr_code, secret: data.totp.secret });
    } catch {
      setError('The sign-in service could not be reached. Try again in a moment.');
    } finally {
      setBusy(false);
    }
  }

  async function confirmEnrolment() {
    if (!enrolment) return;
    const parsed = totpCodeSchema.safeParse(code);
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message);
      return;
    }
    setBusy(true);
    setError(undefined);
    try {
      const verified = await supabaseBrowser().auth.mfa.challengeAndVerify({
        factorId: enrolment.factorId,
        code: parsed.data,
      });
      if (verified.error) {
        setError('That code was not accepted. Codes change every 30 seconds: try the new one.');
        return;
      }
      const res = await fetch('/api/staff/mfa', { method: 'POST' });
      if (!res.ok) {
        setError(
          'Your authenticator is set up, but the server could not record it yet. Reload this page.',
        );
        return;
      }
      setEnrolment(null);
      setJustEnrolled(true);
      await load();
    } catch {
      setError('The sign-in service could not be reached. Try again in a moment.');
    } finally {
      setBusy(false);
    }
  }

  const done = status && status.enrolled && status.session_verified;

  return (
    <div style={{ display: 'grid', gap: 'var(--s-4)', maxWidth: '36rem' }}>
      <PageHeader
        title="Your sign-in security"
        subtitle="Two-step sign-in: your password, then a six-digit code from an authenticator app on your phone."
      />

      {loadError ? <Notice kind="error">{loadError}</Notice> : null}

      {status?.verify_now ? (
        <Card padded>
          <MfaCodeStep
            intro="Enter the six-digit code from your authenticator app to finish signing in."
            onVerified={() => window.location.assign(nextPath())}
          />
        </Card>
      ) : null}

      {status && !status.enrolled ? (
        <Card padded>
          {status.enrol_now ? (
            <Notice kind="warn" title="Set this up before you continue">
              <p className="small">
                CORWADO administrators sign in with two steps. It takes about two minutes and
                needs an authenticator app (for example Google Authenticator or Microsoft
                Authenticator) on your phone.
              </p>
            </Notice>
          ) : (
            <p className="small">
              Two-step sign-in is optional for your role, and recommended.
            </p>
          )}

          {!enrolment ? (
            <div style={{ marginTop: 'var(--s-3)' }}>
              <Button variant="primary" disabled={busy} onClick={() => void start()}>
                {busy ? 'Starting…' : 'Set up two-step sign-in'}
              </Button>
            </div>
          ) : (
            <div style={{ display: 'grid', gap: 'var(--s-3)', marginTop: 'var(--s-3)' }}>
              <p className="small">
                1. In your authenticator app, add an account and scan this code.
              </p>
              {/* A data URL made by Supabase for this factor; nothing is fetched. */}
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={enrolment.qr}
                alt="QR code to add AgriOne to your authenticator app"
                width={200}
                height={200}
                style={{ background: '#fff', padding: 8 }}
              />
              <p className="small">
                Cannot scan? Type this key instead:{' '}
                <code style={{ wordBreak: 'break-all' }}>{enrolment.secret}</code>
              </p>
              <p className="small">2. Enter the six-digit code the app shows.</p>
              <Field label="Six-digit code">
                {(ids) => (
                  <Input
                    {...ids}
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    maxLength={6}
                    value={code}
                    onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
                    disabled={busy}
                  />
                )}
              </Field>
              <div>
                <Button
                  variant="primary"
                  disabled={busy || code.length !== 6}
                  onClick={() => void confirmEnrolment()}
                >
                  {busy ? 'Checking…' : 'Turn on two-step sign-in'}
                </Button>
              </div>
            </div>
          )}
          {error ? (
            <div style={{ marginTop: 'var(--s-3)' }}>
              <Notice kind="error">{error}</Notice>
            </div>
          ) : null}
        </Card>
      ) : null}

      {done ? (
        <Card padded>
          <Notice kind="success" title="Two-step sign-in is on">
            <p className="small">
              Each time you sign in you will be asked for a code from your authenticator app. If
              you lose or replace your phone, ask a Super Admin to reset it from Staff and
              permissions.
            </p>
          </Notice>
          {justEnrolled || new URL(window.location.href).searchParams.get('next') ? (
            <div style={{ marginTop: 'var(--s-3)' }}>
              <Button variant="primary" onClick={() => window.location.assign(nextPath())}>
                Continue
              </Button>
            </div>
          ) : null}
        </Card>
      ) : null}
    </div>
  );
}
