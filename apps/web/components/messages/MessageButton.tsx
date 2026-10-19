'use client';

import Link from 'next/link';
import { useState } from 'react';

import { MESSAGE_MAX_LENGTH, type PostKind } from '@agri-erp/shared';

import { Button, ButtonLink, Notice } from '@/components/ui';
import { t, type Language } from '@/lib/i18n';
import { MessagesError, messagesChanged, startConversation } from '@/lib/messages/client';

import styles from './messages.module.css';

/**
 * "Message" on a listing, a buying request or a service (2026-10-20). Opens a
 * box under the post; the first message starts the conversation (or adds to
 * the one this account already has about the post) and then links to it.
 * Phone numbers stay private: this is how people reach each other.
 *
 * Signed out, the server answers 401 and the box offers sign-in instead.
 * Starting needs signal; replies in the conversation can wait for it.
 */
export function MessageButton({
  postKind,
  postId,
  language = 'en',
}: {
  postKind: PostKind;
  postId: string;
  language?: Language;
}) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [signIn, setSignIn] = useState(false);
  const [sentTo, setSentTo] = useState<string | null>(null);

  if (!open) {
    return (
      <Button variant="secondary" onClick={() => setOpen(true)}>
        {t('msg.button', language)}
      </Button>
    );
  }

  if (sentTo) {
    return (
      <div className={styles.box}>
        <Notice kind="success">{t('msg.sent', language)}</Notice>
        <div className={styles.actions}>
          <ButtonLink href={`/messages?c=${sentTo}`}>{t('msg.open', language)}</ButtonLink>
        </div>
      </div>
    );
  }

  async function send(event: React.FormEvent) {
    event.preventDefault();
    const body = draft.trim();
    if (!body) return;
    setBusy(true);
    setError(null);
    try {
      const got = await startConversation({ post_kind: postKind, post_id: postId, body });
      setSentTo(got.conversation.id);
      messagesChanged();
    } catch (e) {
      if (e instanceof MessagesError && e.status === 401) setSignIn(true);
      else if (e instanceof MessagesError && e.status === 0)
        setError(t('msg.needsSignal', language));
      else setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  if (signIn) {
    return (
      <div className={styles.box}>
        <p>{t('msg.signIn', language)}</p>
        <div className={styles.actions}>
          <ButtonLink href="/join">{t('msg.signIn', language)}</ButtonLink>
        </div>
      </div>
    );
  }

  return (
    <form className={styles.box} onSubmit={(e) => void send(e)}>
      <h2>{t('msg.compose', language)}</h2>
      <p className={styles.lead}>{t('msg.composeLead', language)}</p>
      <textarea
        className={styles.input}
        value={draft}
        rows={3}
        dir="auto"
        maxLength={MESSAGE_MAX_LENGTH}
        placeholder={t('msg.placeholder', language)}
        aria-label={t('msg.placeholder', language)}
        onChange={(e) => setDraft(e.target.value)}
      />
      {error ? <Notice kind="error">{error}</Notice> : null}
      <div className={styles.actions}>
        <Button type="submit" disabled={busy || !draft.trim()}>
          {t('msg.send', language)}
        </Button>
        <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
          {t('msg.cancel', language)}
        </Button>
      </div>
      <p className={styles.safety}>
        {t('msg.privacy', language)} <Link href="/messages">{t('msg.title', language)}</Link>
      </p>
    </form>
  );
}
