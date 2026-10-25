'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';

import type { InvitationSummary } from '@agri-erp/shared';

import { Button, Notice } from '@/components/ui';

import { InvitationCard } from './Organisations';
import { TEAM_WORDS, errorText, sendJson } from './words';

type Preview = InvitationSummary & { for_me: boolean };

/**
 * /invite/:token -- the page an invitation link opens (2026-10-27).
 *
 * It needs a signed-in account: the API refuses anyone else (401), and the
 * page then asks the person to sign in with the phone or email the invitation
 * went to. Signed in, it DISCLOSES the organisation, the role and every
 * permission before anything is accepted; signed in as someone else, it says
 * so and offers nothing to accept.
 */
export function InviteAccept({ token }: { token: string }) {
  const w = TEAM_WORDS.en;
  const [state, setState] = useState<
    | { kind: 'loading' }
    | { kind: 'signin' }
    | { kind: 'invalid' }
    | { kind: 'ready'; invitation: Preview }
    | { kind: 'done'; accepted: boolean }
  >({ kind: 'loading' });
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      const response = await fetch(
        `/api/organizations/invitations?token=${encodeURIComponent(token)}`,
        { cache: 'no-store' },
      ).catch(() => null);
      if (!response) return setState({ kind: 'invalid' });
      if (response.status === 401 || response.status === 403) return setState({ kind: 'signin' });
      if (!response.ok) return setState({ kind: 'invalid' });
      setState({ kind: 'ready', invitation: ((await response.json()) as { data: Preview }).data });
    })();
  }, [token]);

  async function answer(accept: boolean) {
    setError(null);
    const response = await sendJson('/api/organizations/invitations', 'POST', {
      token,
      accept,
    }).catch(() => null);
    if (!response?.ok) {
      setError(response ? await errorText(response, w.failed) : w.failed);
      return;
    }
    setState({ kind: 'done', accepted: accept });
  }

  return (
    <main
      id="main"
      style={{ maxWidth: 560, margin: '0 auto', padding: '24px 16px', display: 'grid', gap: 16 }}
    >
      <h1 style={{ margin: 0 }}>{w.inviteTitle}</h1>
      {state.kind === 'loading' ? <p className="small muted">…</p> : null}
      {state.kind === 'invalid' ? <Notice kind="error">{w.notFoundInvite}</Notice> : null}
      {state.kind === 'signin' ? (
        <Notice kind="info">
          <p className="small">{w.signInFirst}</p>
          <Link href="/login">{w.signIn}</Link>
        </Notice>
      ) : null}
      {state.kind === 'ready' ? (
        <>
          {state.invitation.state !== 'pending' ? (
            <Notice kind="warn">{w.state[state.invitation.state] ?? state.invitation.state}</Notice>
          ) : null}
          {!state.invitation.for_me ? <Notice kind="warn">{w.otherAccount}</Notice> : null}
          {state.invitation.for_me && state.invitation.state === 'pending' ? (
            <InvitationCard
              invitation={state.invitation}
              language="en"
              onAnswer={(accept) => void answer(accept)}
            />
          ) : null}
        </>
      ) : null}
      {state.kind === 'done' ? (
        <Notice kind="success">
          <p className="small">{state.accepted ? w.accepted : w.declined}</p>
          <Button variant="secondary" onClick={() => window.location.assign('/organisations')}>
            {w.title}
          </Button>
        </Notice>
      ) : null}
      {error ? <Notice kind="error">{error}</Notice> : null}
    </main>
  );
}
