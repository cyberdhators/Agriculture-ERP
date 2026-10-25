'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';

import {
  GRANTABLE_ORG_PERMISSIONS,
  ORG_SENDER_AFTER,
  VIEWER_ORG_PERMISSIONS,
  memberMay,
  type InvitationSummary,
  type MyOrganization,
  type OrgPermission,
  type OrgPreset,
  type OrgSenderAfter,
  type TeamMember,
} from '@agri-erp/shared';

import { Button, Checkbox, Field, Input, Notice, Select, Textarea } from '@/components/ui';

import {
  PERMISSION_WORDS,
  PRESET_WORDS,
  SENDER_AFTER_WORDS,
  TEAM_WORDS,
  errorText,
  sendJson,
  teamBase,
  type Lang,
} from './words';

type Org = MyOrganization & { needs_second_administrator: boolean };
type Say = (ok: boolean, text: string) => void;

const box: React.CSSProperties = {
  border: '1px solid var(--color-border, #d9d9d9)',
  borderRadius: 8,
  padding: 12,
  display: 'flex',
  flexDirection: 'column',
  gap: 10,
};
const col: React.CSSProperties = { display: 'flex', flexDirection: 'column', gap: 10 };
const row: React.CSSProperties = { display: 'flex', flexWrap: 'wrap', gap: 8 };

/**
 * One organisation, for its members (2026-10-27, team access). What each
 * person sees follows their membership: everyone sees the team and their own
 * membership; `profile.edit` edits and publishes the profile; administrators
 * invite, change roles and permissions, remove access, hand over and close.
 * The server enforces every one of these; the page only hides what would be
 * refused.
 */
export function OrganisationTeam({
  id,
  side,
  language = 'en',
}: {
  id: string;
  side: 'farmer' | 'buyer';
  language?: Lang;
}) {
  const w = TEAM_WORDS[language];
  const [org, setOrg] = useState<Org | null>(null);
  const [members, setMembers] = useState<TeamMember[]>([]);
  const [invitations, setInvitations] = useState<InvitationSummary[]>([]);
  const [missing, setMissing] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  const load = useCallback(async () => {
    const response = await fetch(`/api/organizations/${id}`, { cache: 'no-store' }).catch(
      () => null,
    );
    if (!response?.ok) {
      setMissing(true);
      return;
    }
    const current = ((await response.json()) as { data: Org }).data;
    setOrg(current);
    const team = await fetch(`/api/organizations/${id}/members`, { cache: 'no-store' });
    if (team.ok) setMembers(((await team.json()) as { data: TeamMember[] }).data);
    if (current.preset === 'administrator') {
      const inv = await fetch(`/api/organizations/${id}/invitations`, { cache: 'no-store' });
      if (inv.ok) setInvitations(((await inv.json()) as { data: InvitationSummary[] }).data);
    }
  }, [id]);

  useEffect(() => {
    void load();
  }, [load]);

  const say: Say = (ok, text) => setMessage({ ok, text });

  if (missing) {
    return (
      <Notice kind="error">
        <p className="small">{w.failed}</p>
        <Link href={teamBase(side)}>{w.back}</Link>
      </Notice>
    );
  }
  if (!org) return <p className="small muted">…</p>;

  const self = {
    id: org.member_id,
    preset: org.preset,
    permissions: org.permissions,
    status: 'active' as const,
  };
  const isAdmin = org.preset === 'administrator';
  const canEdit = memberMay(self, 'profile.edit') && !org.closed;

  return (
    <div style={{ ...col, gap: 20, maxWidth: 760 }}>
      <Link href={teamBase(side)} className="small">
        ← {w.back}
      </Link>
      <header>
        <h1 style={{ margin: 0 }} dir="auto">
          {org.name}
        </h1>
        <p className="small muted" style={{ margin: 0 }}>
          {PRESET_WORDS[language][org.preset].label} ·{' '}
          {org.closed ? w.closed : org.status === 'published' ? w.published : w.draft}
        </p>
        {org.status === 'published' && !org.closed ? (
          <Link href={`/organisations/${org.id}`} className="small">
            {w.viewPublic}
          </Link>
        ) : null}
        {/* 2026-10-28: the shared advice inbox, for members who handle advice. */}
        {memberMay(self, 'advisory.handle') || memberMay(self, 'profile.edit') ? (
          <Link href={`${teamBase(side)}/${org.id}/advice`} className="small">
            {language === 'ar' ? 'طلبات المشورة' : 'Advice requests and advice profile'}
          </Link>
        ) : null}
      </header>

      {message ? (
        <Notice kind={message.ok ? 'success' : 'error'}>
          <p className="small">{message.text}</p>
        </Notice>
      ) : null}
      {org.closed ? <Notice kind="warn">{w.closedNote}</Notice> : null}
      {isAdmin && org.needs_second_administrator && !org.closed ? (
        <Notice kind="info">{w.secondAdmin}</Notice>
      ) : null}

      {canEdit ? <ProfileEditor org={org} language={language} say={say} reload={load} /> : null}

      {!org.closed ? (
        <MyMembership org={org} side={side} language={language} say={say} reload={load} />
      ) : null}

      <section style={col}>
        <h2 style={{ margin: 0 }}>{w.team}</h2>
        {members.map((m) => (
          <MemberRow
            key={m.id}
            org={org}
            member={m}
            language={language}
            manage={isAdmin && !org.closed}
            say={say}
            reload={load}
          />
        ))}
      </section>

      {isAdmin && !org.closed ? (
        <>
          <InviteForm orgId={org.id} language={language} say={say} reload={load} />
          <Handover org={org} members={members} language={language} say={say} reload={load} />
          <InvitationList
            orgId={org.id}
            invitations={invitations}
            members={members}
            language={language}
            say={say}
            reload={load}
          />
          <CloseOrganisation org={org} side={side} language={language} say={say} />
        </>
      ) : null}
    </div>
  );
}

function ProfileEditor({
  org,
  language,
  say,
  reload,
}: {
  org: Org;
  language: Lang;
  say: Say;
  reload: () => Promise<void>;
}) {
  const w = TEAM_WORDS[language];
  const [name, setName] = useState(org.name);
  const [about, setAbout] = useState(org.about ?? '');
  const [location, setLocation] = useState(org.location ?? '');
  const [phone, setPhone] = useState(org.public_phone ?? '');
  const [email, setEmail] = useState(org.public_email ?? '');
  const [showTeam, setShowTeam] = useState(org.show_team);
  const [busy, setBusy] = useState(false);

  async function save(extra: Record<string, unknown> = {}) {
    setBusy(true);
    const response = await sendJson(`/api/organizations/${org.id}`, 'PATCH', {
      name,
      about,
      location,
      public_phone: phone,
      public_email: email,
      show_team: showTeam,
      ...extra,
    }).catch(() => null);
    setBusy(false);
    if (!response?.ok) {
      say(false, response ? await errorText(response, w.failed) : w.failed);
      return;
    }
    say(true, w.saved);
    await reload();
  }

  return (
    <section style={box}>
      <h2 style={{ margin: 0 }}>{w.profile}</h2>
      <Field label={w.name}>
        {(ids) => (
          <Input {...ids} dir="auto" value={name} onChange={(e) => setName(e.target.value)} />
        )}
      </Field>
      <Field label={w.about} optional>
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
      <Field label={w.location} optional>
        {(ids) => (
          <Input
            {...ids}
            dir="auto"
            value={location}
            onChange={(e) => setLocation(e.target.value)}
          />
        )}
      </Field>
      <Field label={w.publicPhone} optional>
        {(ids) => (
          <Input
            {...ids}
            inputMode="tel"
            className="mono"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
          />
        )}
      </Field>
      <Field label={w.publicEmail} optional>
        {(ids) => (
          <Input {...ids} type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
        )}
      </Field>
      <Checkbox
        label={w.showTeam}
        checked={showTeam}
        onChange={(e) => setShowTeam(e.target.checked)}
      />
      <p className="small muted" style={{ margin: 0 }}>
        {w.publicNote}
      </p>
      <div style={row}>
        <Button disabled={busy} onClick={() => void save()}>
          {busy ? w.saving : w.edit}
        </Button>
        {org.status === 'draft' ? (
          <Button
            variant="secondary"
            disabled={busy}
            onClick={() => void save({ status: 'published' })}
          >
            {w.publish}
          </Button>
        ) : (
          <Button variant="ghost" disabled={busy} onClick={() => void save({ status: 'draft' })}>
            {w.unpublish}
          </Button>
        )}
      </div>
    </section>
  );
}

function MyMembership({
  org,
  side,
  language,
  say,
  reload,
}: {
  org: Org;
  side: 'farmer' | 'buyer';
  language: Lang;
  say: Say;
  reload: () => Promise<void>;
}) {
  const w = TEAM_WORDS[language];
  const [show, setShow] = useState(org.show_on_profile);
  const [title, setTitle] = useState(org.public_title ?? '');

  async function save() {
    const response = await sendJson(`/api/organizations/${org.id}/membership`, 'PATCH', {
      show_on_profile: show,
      public_title: title,
    }).catch(() => null);
    if (!response?.ok) {
      say(false, response ? await errorText(response, w.failed) : w.failed);
      return;
    }
    say(true, w.saved);
    await reload();
  }

  async function leave() {
    if (!window.confirm(w.leaveConfirm)) return;
    const response = await sendJson(`/api/organizations/${org.id}/leave`, 'POST').catch(() => null);
    if (!response?.ok) {
      say(false, response ? await errorText(response, w.failed) : w.failed);
      return;
    }
    window.location.assign(teamBase(side));
  }

  return (
    <section style={box}>
      <h2 style={{ margin: 0 }}>{w.me}</h2>
      <Checkbox label={w.showMe} checked={show} onChange={(e) => setShow(e.target.checked)} />
      <Field label={w.myTitle} optional>
        {(ids) => (
          <Input {...ids} dir="auto" value={title} onChange={(e) => setTitle(e.target.value)} />
        )}
      </Field>
      <div style={row}>
        <Button variant="secondary" onClick={() => void save()}>
          {w.edit}
        </Button>
        <Button variant="ghost" onClick={() => void leave()}>
          {w.leave}
        </Button>
      </div>
    </section>
  );
}

function PermissionPicker({
  preset,
  value,
  onChange,
  language,
}: {
  preset: OrgPreset;
  value: OrgPermission[];
  onChange: (next: OrgPermission[]) => void;
  language: Lang;
}) {
  const allowed: readonly OrgPermission[] =
    preset === 'viewer' ? VIEWER_ORG_PERMISSIONS : GRANTABLE_ORG_PERMISSIONS;
  return (
    <fieldset style={{ border: 0, padding: 0, margin: 0, ...col, gap: 4 }}>
      <legend className="small" style={{ fontWeight: 600 }}>
        {TEAM_WORDS[language].permissions}
      </legend>
      {allowed.map((p) => (
        <Checkbox
          key={p}
          label={PERMISSION_WORDS[language][p]}
          checked={value.includes(p)}
          onChange={(e) =>
            onChange(e.target.checked ? [...value, p] : value.filter((x) => x !== p))
          }
        />
      ))}
    </fieldset>
  );
}

const defaults = (preset: OrgPreset): OrgPermission[] =>
  preset === 'viewer'
    ? ['inbox.read']
    : ['listings.manage', 'inbox.read', 'inbox.reply', 'advisory.handle'];

function MemberRow({
  org,
  member,
  language,
  manage,
  say,
  reload,
}: {
  org: Org;
  member: TeamMember;
  language: Lang;
  manage: boolean;
  say: Say;
  reload: () => Promise<void>;
}) {
  const w = TEAM_WORDS[language];
  const [editing, setEditing] = useState<'role' | 'revoke' | null>(null);
  const [preset, setPreset] = useState<OrgPreset>(
    member.preset === 'administrator' ? 'contributor' : member.preset,
  );
  const [permissions, setPermissions] = useState<OrgPermission[]>(
    member.preset === 'administrator' ? defaults('contributor') : member.permissions,
  );
  const [reason, setReason] = useState('');
  const active = member.status === 'active';

  async function saveRole() {
    const response = await sendJson(`/api/organizations/${org.id}/members/${member.id}`, 'PATCH', {
      preset,
      permissions,
    }).catch(() => null);
    if (!response?.ok) {
      say(false, response ? await errorText(response, w.failed) : w.failed);
      return;
    }
    setEditing(null);
    say(true, w.saved);
    await reload();
  }

  async function revoke() {
    const response = await sendJson(
      `/api/organizations/${org.id}/members/${member.id}/revoke`,
      'POST',
      { reason },
    ).catch(() => null);
    if (!response?.ok) {
      say(false, response ? await errorText(response, w.failed) : w.failed);
      return;
    }
    setEditing(null);
    say(true, w.saved);
    await reload();
  }

  return (
    <article style={{ ...box, opacity: active ? 1 : 0.7 }}>
      <div style={{ ...row, justifyContent: 'space-between', alignItems: 'baseline' }}>
        <strong dir="auto">
          {member.name}
          {member.is_me ? ` (${w.you})` : ''}
        </strong>
        <span className="small">
          {active ? PRESET_WORDS[language][member.preset].label : w.ended}
        </span>
      </div>
      {active ? (
        <p className="small muted" style={{ margin: 0 }}>
          {member.permissions.map((p) => PERMISSION_WORDS[language][p]).join(' · ')}
        </p>
      ) : (
        <p className="small muted" style={{ margin: 0 }}>
          {member.ended_at ? new Date(member.ended_at).toLocaleDateString() : ''}
          {member.end_reason ? ` — ${member.end_reason}` : ''}
        </p>
      )}
      {manage && active ? (
        <div style={row}>
          <Button size="small" variant="secondary" onClick={() => setEditing('role')}>
            {w.change}
          </Button>
          {!member.is_me ? (
            <Button size="small" variant="ghost" onClick={() => setEditing('revoke')}>
              {w.revoke}
            </Button>
          ) : null}
        </div>
      ) : null}
      {editing === 'role' ? (
        <div style={col}>
          <Field label={w.role}>
            {(ids) => (
              <Select
                {...ids}
                value={preset}
                onChange={(e) => {
                  const next = e.target.value as OrgPreset;
                  setPreset(next);
                  setPermissions(defaults(next));
                }}
              >
                <option value="contributor">{PRESET_WORDS[language].contributor.label}</option>
                <option value="viewer">{PRESET_WORDS[language].viewer.label}</option>
              </Select>
            )}
          </Field>
          <PermissionPicker
            preset={preset}
            value={permissions}
            onChange={setPermissions}
            language={language}
          />
          <div style={row}>
            <Button size="small" onClick={() => void saveRole()}>
              {w.saveRole}
            </Button>
            <Button size="small" variant="ghost" onClick={() => setEditing(null)}>
              {w.dismiss}
            </Button>
          </div>
        </div>
      ) : null}
      {editing === 'revoke' ? (
        <div style={col}>
          <p className="small muted" style={{ margin: 0 }}>
            {w.revokeNote}
          </p>
          <Field label={w.revokeReason}>
            {(ids) => <Input {...ids} value={reason} onChange={(e) => setReason(e.target.value)} />}
          </Field>
          <div style={row}>
            <Button size="small" variant="danger" onClick={() => void revoke()}>
              {w.revoke}
            </Button>
            <Button size="small" variant="ghost" onClick={() => setEditing(null)}>
              {w.dismiss}
            </Button>
          </div>
        </div>
      ) : null}
    </article>
  );
}

function InviteForm({
  orgId,
  language,
  say,
  reload,
}: {
  orgId: string;
  language: Lang;
  say: Say;
  reload: () => Promise<void>;
}) {
  const w = TEAM_WORDS[language];
  const [channel, setChannel] = useState<'phone' | 'email'>('phone');
  const [target, setTarget] = useState('');
  const [preset, setPreset] = useState<OrgPreset>('contributor');
  const [permissions, setPermissions] = useState<OrgPermission[]>(defaults('contributor'));
  const [link, setLink] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  async function invite(event: React.FormEvent) {
    event.preventDefault();
    setLink(null);
    const response = await sendJson(`/api/organizations/${orgId}/invitations`, 'POST', {
      channel,
      target,
      preset,
      ...(preset === 'administrator' ? {} : { permissions }),
    }).catch(() => null);
    if (!response?.ok) {
      say(false, response ? await errorText(response, w.failed) : w.failed);
      return;
    }
    const body = (await response.json()) as { data: { link: string } };
    setLink(body.data.link);
    setTarget('');
    await reload();
  }

  return (
    <section style={box}>
      <h2 style={{ margin: 0 }}>{w.invite}</h2>
      <form onSubmit={(e) => void invite(e)} noValidate style={col}>
        <Field label={w.channel}>
          {(ids) => (
            <Select
              {...ids}
              value={channel}
              onChange={(e) => setChannel(e.target.value as 'phone' | 'email')}
            >
              <option value="phone">{w.phone}</option>
              <option value="email">{w.email}</option>
            </Select>
          )}
        </Field>
        <Field label={w.target}>
          {(ids) => (
            <Input
              {...ids}
              inputMode={channel === 'phone' ? 'tel' : 'email'}
              value={target}
              placeholder={channel === 'phone' ? '+211 9XX XXX XXX' : 'name@example.org'}
              onChange={(e) => setTarget(e.target.value)}
            />
          )}
        </Field>
        <Field label={w.role} hint={PRESET_WORDS[language][preset].about}>
          {(ids) => (
            <Select
              {...ids}
              value={preset}
              onChange={(e) => {
                const next = e.target.value as OrgPreset;
                setPreset(next);
                setPermissions(defaults(next));
              }}
            >
              {(['administrator', 'contributor', 'viewer'] as const).map((p) => (
                <option key={p} value={p}>
                  {PRESET_WORDS[language][p].label}
                </option>
              ))}
            </Select>
          )}
        </Field>
        {preset !== 'administrator' ? (
          <PermissionPicker
            preset={preset}
            value={permissions}
            onChange={setPermissions}
            language={language}
          />
        ) : null}
        <div>
          <Button type="submit">{w.sendInvite}</Button>
        </div>
      </form>
      {link ? (
        <Notice kind="success">
          <p className="small">{w.inviteLink}</p>
          <p className="small mono" style={{ wordBreak: 'break-all' }}>
            {link}
          </p>
          <Button
            size="small"
            variant="secondary"
            onClick={() =>
              void navigator.clipboard
                ?.writeText(link)
                .then(() => setCopied(true))
                .catch(() => undefined)
            }
          >
            {copied ? w.copied : w.copy}
          </Button>
        </Notice>
      ) : null}
    </section>
  );
}

function Handover({
  org,
  members,
  language,
  say,
  reload,
}: {
  org: Org;
  members: TeamMember[];
  language: Lang;
  say: Say;
  reload: () => Promise<void>;
}) {
  const w = TEAM_WORDS[language];
  const candidates = members.filter(
    (m) => m.status === 'active' && !m.is_me && m.preset !== 'administrator',
  );
  const [memberId, setMemberId] = useState('');
  const [after, setAfter] = useState<OrgSenderAfter>('administrator');
  if (candidates.length === 0) return null;

  async function offer() {
    const response = await sendJson(`/api/organizations/${org.id}/transfer`, 'POST', {
      member_id: memberId,
      sender_after: after,
    }).catch(() => null);
    if (!response?.ok) {
      say(false, response ? await errorText(response, w.failed) : w.failed);
      return;
    }
    say(true, w.offered);
    await reload();
  }

  return (
    <section style={box}>
      <h2 style={{ margin: 0 }}>{w.handover}</h2>
      <Field label={w.handoverTo}>
        {(ids) => (
          <Select {...ids} value={memberId} onChange={(e) => setMemberId(e.target.value)}>
            <option value="">{w.choose}</option>
            {candidates.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}
              </option>
            ))}
          </Select>
        )}
      </Field>
      <Field label={w.handoverThen}>
        {(ids) => (
          <Select
            {...ids}
            value={after}
            onChange={(e) => setAfter(e.target.value as OrgSenderAfter)}
          >
            {ORG_SENDER_AFTER.map((a) => (
              <option key={a} value={a}>
                {SENDER_AFTER_WORDS[language][a]}
              </option>
            ))}
          </Select>
        )}
      </Field>
      <div>
        <Button variant="secondary" disabled={!memberId} onClick={() => void offer()}>
          {w.offer}
        </Button>
      </div>
    </section>
  );
}

function InvitationList({
  orgId,
  invitations,
  members,
  language,
  say,
  reload,
}: {
  orgId: string;
  invitations: InvitationSummary[];
  members: TeamMember[];
  language: Lang;
  say: Say;
  reload: () => Promise<void>;
}) {
  const w = TEAM_WORDS[language];
  if (invitations.length === 0) return null;

  async function cancel(invitationId: string) {
    const response = await sendJson(
      `/api/organizations/${orgId}/invitations/${invitationId}/cancel`,
      'POST',
    ).catch(() => null);
    if (!response?.ok) {
      say(false, response ? await errorText(response, w.failed) : w.failed);
      return;
    }
    await reload();
  }

  return (
    <section style={col}>
      <h2 style={{ margin: 0 }}>{w.sentInvitations}</h2>
      {invitations.map((inv) => {
        const who =
          inv.kind === 'transfer'
            ? (members.find((m) => m.id === inv.target_member_id)?.name ?? '—')
            : inv.target;
        return (
          <article key={inv.id} style={{ ...box, gap: 4 }}>
            <div style={{ ...row, justifyContent: 'space-between' }}>
              <strong className={inv.kind === 'member' ? 'mono' : undefined}>{who}</strong>
              <span className="small">{w.state[inv.state] ?? inv.state}</span>
            </div>
            <p className="small muted" style={{ margin: 0 }}>
              {inv.kind === 'transfer' ? w.handover : PRESET_WORDS[language][inv.preset].label} ·{' '}
              {w.delivery[inv.delivery] ?? inv.delivery}
            </p>
            {inv.state === 'pending' ? (
              <div>
                <Button size="small" variant="ghost" onClick={() => void cancel(inv.id)}>
                  {w.cancel}
                </Button>
              </div>
            ) : null}
          </article>
        );
      })}
    </section>
  );
}

function CloseOrganisation({
  org,
  side,
  language,
  say,
}: {
  org: Org;
  side: 'farmer' | 'buyer';
  language: Lang;
  say: Say;
}) {
  const w = TEAM_WORDS[language];
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('');
  const [confirm, setConfirm] = useState(false);

  async function close() {
    const response = await sendJson(`/api/organizations/${org.id}/close`, 'POST', {
      reason,
      confirm,
    }).catch(() => null);
    if (!response?.ok) {
      say(false, response ? await errorText(response, w.failed) : w.failed);
      return;
    }
    window.location.assign(teamBase(side));
  }

  return (
    <section style={box}>
      <h2 style={{ margin: 0 }}>{w.close}</h2>
      <p className="small muted" style={{ margin: 0 }}>
        {w.closeLead}
      </p>
      {!open ? (
        <div>
          <Button variant="danger" onClick={() => setOpen(true)}>
            {w.close}
          </Button>
        </div>
      ) : (
        <div style={col}>
          <Field label={w.closeReason}>
            {(ids) => <Input {...ids} value={reason} onChange={(e) => setReason(e.target.value)} />}
          </Field>
          <Checkbox
            label={w.closeConfirm}
            checked={confirm}
            onChange={(e) => setConfirm(e.target.checked)}
          />
          <div style={row}>
            <Button variant="danger" disabled={!confirm} onClick={() => void close()}>
              {w.closeButton}
            </Button>
            <Button variant="ghost" onClick={() => setOpen(false)}>
              {w.dismiss}
            </Button>
          </div>
        </div>
      )}
    </section>
  );
}
