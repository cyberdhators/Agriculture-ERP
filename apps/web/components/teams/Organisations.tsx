'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';

import {
  ACTIVITIES,
  GROUP_KINDS,
  ORG_PROFILE_KINDS,
  createOrganizationSchema,
  type InvitationSummary,
  type MyOrganization,
} from '@agri-erp/shared';

import { ABOUT_LABELS } from '@/components/account/AccountActivities';
import { Button, Checkbox, Field, Input, Notice, Select, Textarea } from '@/components/ui';

import { OrganisationStateField } from './StateField';

import {
  PERMISSION_WORDS,
  PRESET_WORDS,
  TEAM_WORDS,
  errorText,
  sendJson,
  teamBase,
  type Lang,
} from './words';

/**
 * Settings → Organisations (2026-10-27, team access): invitations waiting for
 * the signed-in person (the organisation, the role and every permission shown
 * BEFORE accepting), the organisations they belong to, and "Create an
 * organisation profile". Shared by the farmer and buyer sides of one account.
 */
export function Organisations({
  side,
  language = 'en',
}: {
  side: 'farmer' | 'buyer';
  language?: Lang;
}) {
  const w = TEAM_WORDS[language];
  const [orgs, setOrgs] = useState<MyOrganization[] | null>(null);
  const [invites, setInvites] = useState<InvitationSummary[]>([]);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  const load = useCallback(async () => {
    const [list, inv] = await Promise.all([
      fetch('/api/organizations', { cache: 'no-store' }).catch(() => null),
      fetch('/api/organizations/invitations', { cache: 'no-store' }).catch(() => null),
    ]);
    setOrgs(list?.ok ? ((await list.json()) as { data: MyOrganization[] }).data : []);
    setInvites(inv?.ok ? ((await inv.json()) as { data: InvitationSummary[] }).data : []);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function respond(id: string, accept: boolean) {
    setMessage(null);
    const response = await sendJson('/api/organizations/invitations', 'POST', {
      invitation_id: id,
      accept,
    }).catch(() => null);
    if (!response?.ok) {
      setMessage({ ok: false, text: response ? await errorText(response, w.failed) : w.failed });
      return;
    }
    setMessage({ ok: true, text: accept ? w.accepted : w.declined });
    await load();
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20, maxWidth: 760 }}>
      <header>
        <h1 style={{ margin: 0 }}>{w.title}</h1>
        <p className="small muted">{w.lead}</p>
      </header>

      {message ? (
        <Notice kind={message.ok ? 'success' : 'error'}>
          <p className="small">{message.text}</p>
        </Notice>
      ) : null}

      <section style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <h2 style={{ margin: 0 }}>{w.invitations}</h2>
        {invites.length === 0 ? <p className="small muted">{w.noInvitations}</p> : null}
        {invites.map((inv) => (
          <InvitationCard
            key={inv.id}
            invitation={inv}
            language={language}
            onAnswer={(accept) => void respond(inv.id, accept)}
          />
        ))}
      </section>

      <section style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <h2 style={{ margin: 0 }}>{w.yours}</h2>
        {orgs === null ? <p className="small muted">…</p> : null}
        {orgs?.length === 0 ? <p className="small muted">{w.none}</p> : null}
        <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'grid', gap: 8 }}>
          {orgs?.map((o) => (
            <li
              key={o.id}
              style={{
                border: '1px solid var(--color-border, #d9d9d9)',
                borderRadius: 8,
                padding: 12,
                display: 'flex',
                flexWrap: 'wrap',
                gap: 8,
                alignItems: 'center',
                justifyContent: 'space-between',
              }}
            >
              <div style={{ minWidth: 0 }}>
                <strong dir="auto">{o.name}</strong>
                <p className="small muted" style={{ margin: 0 }}>
                  {PRESET_WORDS[language][o.preset].label} ·{' '}
                  {o.closed ? w.closed : o.status === 'published' ? w.published : w.draft}
                </p>
              </div>
              <Link href={`${teamBase(side)}/${o.id}`} className="small">
                {w.open}
              </Link>
            </li>
          ))}
        </ul>
      </section>

      <CreateOrganisation
        language={language}
        onCreated={(id) => window.location.assign(`${teamBase(side)}/${id}`)}
      />
    </div>
  );
}

export function InvitationCard({
  invitation,
  language,
  onAnswer,
}: {
  invitation: InvitationSummary;
  language: Lang;
  onAnswer: (accept: boolean) => void;
}) {
  const w = TEAM_WORDS[language];
  const preset = PRESET_WORDS[language][invitation.preset];
  return (
    <article
      style={{
        border: '1px solid var(--color-border, #d9d9d9)',
        borderRadius: 8,
        padding: 12,
        display: 'flex',
        flexDirection: 'column',
        gap: 6,
      }}
    >
      <strong dir="auto">{invitation.organization_name}</strong>
      {invitation.kind === 'transfer' ? <p className="small">{w.handoverOffer}</p> : null}
      <p className="small" style={{ margin: 0 }}>
        {w.invitedAs}: <strong>{preset.label}</strong> — {preset.about}
      </p>
      <ul className="small" style={{ margin: 0, paddingInlineStart: 18 }}>
        {invitation.permissions.map((p) => (
          <li key={p}>{PERMISSION_WORDS[language][p]}</li>
        ))}
      </ul>
      <p className="small muted" style={{ margin: 0 }}>
        {w.expires}: {new Date(invitation.expires_at).toLocaleDateString()}
      </p>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <Button onClick={() => onAnswer(true)}>{w.accept}</Button>
        <Button variant="ghost" onClick={() => onAnswer(false)}>
          {w.decline}
        </Button>
      </div>
    </article>
  );
}

function CreateOrganisation({
  language,
  onCreated,
}: {
  language: Lang;
  onCreated: (id: string) => void;
}) {
  const w = TEAM_WORDS[language];
  const labels = ABOUT_LABELS[language] as Record<string, string>;
  const [name, setName] = useState('');
  const [kind, setKind] = useState<string>('');
  const [groupKind, setGroupKind] = useState('');
  const [activities, setActivities] = useState<string[]>([]);
  const [about, setAbout] = useState('');
  const [location, setLocation] = useState('');
  const [stateId, setStateId] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [failure, setFailure] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setFailure(null);
    const input = {
      name,
      profile_kind: kind,
      group_kind: kind === 'group' ? groupKind || null : null,
      activities,
      about,
      location,
      state_id: stateId === '' ? null : stateId,
    };
    const parsed = createOrganizationSchema.safeParse(input);
    if (!parsed.success) {
      const next: Record<string, string> = {};
      for (const issue of parsed.error.issues) {
        const key = String(issue.path[0] ?? 'name');
        next[key] ??= issue.message;
      }
      setErrors(next);
      return;
    }
    setErrors({});
    setBusy(true);
    const response = await sendJson('/api/organizations', 'POST', input).catch(() => null);
    setBusy(false);
    if (!response?.ok) {
      setFailure(response ? await errorText(response, w.failed) : w.failed);
      return;
    }
    const body = (await response.json()) as { data: { id: string } };
    onCreated(body.data.id);
  }

  return (
    <section style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <h2 style={{ margin: 0 }}>{w.create}</h2>
      <form
        onSubmit={(e) => void submit(e)}
        noValidate
        style={{ display: 'flex', flexDirection: 'column', gap: 12 }}
      >
        <Field label={w.name} error={errors.name}>
          {(ids) => (
            <Input {...ids} value={name} dir="auto" onChange={(e) => setName(e.target.value)} />
          )}
        </Field>
        <Field label={w.kind} error={errors.profile_kind}>
          {(ids) => (
            <Select {...ids} value={kind} onChange={(e) => setKind(e.target.value)}>
              <option value="">{w.choose}</option>
              {ORG_PROFILE_KINDS.map((k) => (
                <option key={k} value={k}>
                  {labels[k]}
                </option>
              ))}
            </Select>
          )}
        </Field>
        {kind === 'group' ? (
          <Field label={w.groupKind} error={errors.group_kind}>
            {(ids) => (
              <Select {...ids} value={groupKind} onChange={(e) => setGroupKind(e.target.value)}>
                <option value="">{w.choose}</option>
                {GROUP_KINDS.map((k) => (
                  <option key={k} value={k}>
                    {labels[k]}
                  </option>
                ))}
              </Select>
            )}
          </Field>
        ) : null}
        <fieldset style={{ border: 0, padding: 0, margin: 0 }}>
          <legend className="small" style={{ fontWeight: 600 }}>
            {w.activities}
          </legend>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            {ACTIVITIES.map((a) => (
              <Checkbox
                key={a}
                label={labels[a]}
                checked={activities.includes(a)}
                onChange={(e) =>
                  setActivities((list) =>
                    e.target.checked ? [...list, a] : list.filter((x) => x !== a),
                  )
                }
              />
            ))}
          </div>
        </fieldset>
        <Field label={w.about} error={errors.about} optional>
          {(ids) => (
            <Textarea
              {...ids}
              rows={3}
              dir="auto"
              value={about}
              onChange={(e) => setAbout(e.target.value)}
            />
          )}
        </Field>
        <OrganisationStateField
          language={language}
          value={stateId}
          onChange={setStateId}
          error={errors.state_id}
        />
        <Field label={w.location} error={errors.location} optional>
          {(ids) => (
            <Input
              {...ids}
              dir="auto"
              value={location}
              onChange={(e) => setLocation(e.target.value)}
            />
          )}
        </Field>
        {failure ? <Notice kind="error">{failure}</Notice> : null}
        <div>
          <Button type="submit" disabled={busy}>
            {busy ? w.creating : w.create}
          </Button>
        </div>
      </form>
    </section>
  );
}
