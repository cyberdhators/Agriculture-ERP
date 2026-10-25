'use client';

import { useEffect, useState, type FormEvent } from 'react';

import { SUPPORT_TOPICS, supportMessageSchema, type SupportTopic } from '@agri-erp/shared';

import { PageHead } from '@/components/farmer/AccountShell';
import { Button, Field, Input, Notice, Select, Textarea } from '@/components/ui';
import { useFarmerSession } from '@/lib/farmer-session';
import { t, type TKey } from '@/lib/i18n';
import { usePublicSettings } from '@/lib/settings/client';

import styles from '@/components/farmer/farmer.module.css';

import { SupportContactsCard } from './SupportContacts';

const TOPIC_KEY: Record<SupportTopic, TKey> = {
  account: 'help.topicAccount',
  marketplace: 'help.topicMarketplace',
  messages: 'help.topicMessages',
  technical: 'help.topicTechnical',
  appeal: 'help.topicAppeal',
  other: 'help.topicOther',
};

const FAQ: ReadonlyArray<[TKey, TKey]> = [
  ['help.q1', 'help.a1'],
  ['help.q2', 'help.a2'],
  ['help.q3', 'help.a3'],
  ['help.q4', 'help.a4'],
  ['help.q5', 'help.a5'],
];

/**
 * "Contact CORWADO" (2026-10-21): short answers, then a message form that
 * POSTs /api/support. In the farmer's language. A signed-in farmer's name and
 * phone, or a signed-in buyer's name and email, are filled in for them; the
 * server recognises the sender from the session either way. Reasons beside
 * the fields are the server's, from the same shared schema checked here first.
 */
export function HelpPage() {
  const { language, farmer } = useFarmerSession();
  // 2026-10-27 (settings phase 2): the appeal window, from Settings.
  const publicSettings = usePublicSettings();
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [topic, setTopic] = useState<SupportTopic>('account');
  const [body, setBody] = useState('');
  const [fields, setFields] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);

  useEffect(() => {
    if (farmer) {
      setName((v) => v || `${farmer.given_name} ${farmer.family_name}`.trim());
      setPhone((v) => v || farmer.phone);
      return;
    }
    // A buyer, if this session is one; anyone else simply fills the form in.
    let live = true;
    fetch('/api/buyer/profile')
      .then(async (res) => (res.ok ? ((await res.json()) as { data?: BuyerLite }) : null))
      .then((json) => {
        const person = json?.data?.person;
        if (!live || !person) return;
        setName((v) => v || `${person.given_name} ${person.family_name}`.trim());
        if (person.email) setEmail((v) => v || (person.email ?? ''));
      })
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [farmer]);

  async function send(event: FormEvent) {
    event.preventDefault();
    setError(null);
    // Blank optional fields are left out, not sent empty.
    const input = {
      name,
      topic,
      body,
      ...(phone.trim() ? { phone } : {}),
      ...(email.trim() ? { email } : {}),
    };
    const parsed = supportMessageSchema.safeParse(input);
    if (!parsed.success) {
      const next: Record<string, string> = {};
      for (const issue of parsed.error.issues) {
        const key = String(issue.path[0] ?? '');
        if (key && !next[key]) next[key] = issue.message;
      }
      setFields(next);
      return;
    }
    setFields({});
    setBusy(true);
    try {
      const response = await fetch('/api/support', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(input),
      });
      if (!response.ok) {
        const json = (await response.json().catch(() => ({}))) as {
          error?: { message?: string; fields?: Record<string, string> };
        };
        setFields(json.error?.fields ?? {});
        setError(json.error?.fields ? null : (json.error?.message ?? t('help.failed', language)));
        return;
      }
      setSent(true);
      setBody('');
    } catch {
      setError(t('help.failed', language));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <PageHead title={t('help.title', language)} lead={t('help.lead', language)} />

      <div className={styles.settings}>
        {/* 2026-10-25: About, contacts and links as published in Settings; none shown if unset. */}
        <SupportContactsCard language={language} />

        <section className={styles.settingCard}>
          <h2>{t('help.faqTitle', language)}</h2>
          {FAQ.map(([q, a]) => (
            <details key={q}>
              <summary>
                <strong>{t(q, language)}</strong>
              </summary>
              <p className="small">{t(a, language)}</p>
            </details>
          ))}
        </section>

        <section className={styles.settingCard}>
          <h2>{t('help.formTitle', language)}</h2>
          {sent ? (
            <>
              <Notice kind="success">
                <p className="small">{t('help.sent', language)}</p>
              </Notice>
              <div>
                <Button variant="secondary" onClick={() => setSent(false)}>
                  {t('help.sendAnother', language)}
                </Button>
              </div>
            </>
          ) : (
            <form className={styles.inlineForm} onSubmit={send} noValidate>
              <p className="small muted">{t('help.formLead', language)}</p>
              {error ? (
                <Notice kind="error">
                  <p className="small">{error}</p>
                </Notice>
              ) : null}
              <Field label={t('help.name', language)} error={fields.name}>
                {(ids) => (
                  <Input
                    {...ids}
                    autoComplete="name"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                  />
                )}
              </Field>
              <Field label={t('help.phone', language)} error={fields.phone}>
                {(ids) => (
                  <Input
                    {...ids}
                    inputMode="tel"
                    autoComplete="tel"
                    className="mono"
                    placeholder="+211 9XX XXX XXX"
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                  />
                )}
              </Field>
              <Field label={t('help.email', language)} error={fields.email}>
                {(ids) => (
                  <Input
                    {...ids}
                    type="email"
                    autoComplete="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                  />
                )}
              </Field>
              <Field label={t('help.topic', language)} error={fields.topic}>
                {(ids) => (
                  <Select
                    {...ids}
                    value={topic}
                    onChange={(e) => setTopic(e.target.value as SupportTopic)}
                  >
                    {SUPPORT_TOPICS.map((value) => (
                      <option key={value} value={value}>
                        {t(TOPIC_KEY[value], language)}
                      </option>
                    ))}
                  </Select>
                )}
              </Field>
              {/* 2026-10-26: an appeal -- a suspended person is signed out, so their phone finds the account. */}
              {topic === 'appeal' ? (
                <p className="small muted">
                  {t('help.appealHint', language)}{' '}
                  {t('help.appealWindow', language).replace(
                    '{n}',
                    String(publicSettings?.appeal_window_days ?? 30),
                  )}
                </p>
              ) : null}
              <Field label={t('help.body', language)} error={fields.body}>
                {(ids) => (
                  <Textarea
                    {...ids}
                    rows={5}
                    maxLength={2000}
                    dir="auto"
                    value={body}
                    onChange={(e) => setBody(e.target.value)}
                  />
                )}
              </Field>
              <Button type="submit" variant="primary" disabled={busy}>
                {busy ? t('help.sending', language) : t('help.send', language)}
              </Button>
            </form>
          )}
        </section>
      </div>
    </>
  );
}

interface BuyerLite {
  person?: { given_name: string; family_name: string; email: string | null };
}
