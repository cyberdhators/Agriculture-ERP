'use client';

import { useCallback, useEffect, useState } from 'react';

import { recoverOrganizationSchema } from '@agri-erp/shared';

import { Button, Field, Input, Notice, PageHeader, PasswordInput, Select } from '@/components/ui';

import { errorText, sendJson } from './words';

interface OrgRow {
  id: string;
  name: string;
  profile_kind: string;
  status: string;
  closed: boolean;
  created_at: string;
  administrators: number;
  members: {
    id: string;
    name: string;
    preset: string;
    status: string;
    ended_at: string | null;
    end_reason: string | null;
  }[];
}

/**
 * Admin → Organisations (2026-10-27, team access). Staff with support.handle
 * find an organisational profile and its team, and -- only on evidence --
 * restore its administration to a person who is or was a member: a reason, an
 * evidence reference and the staff member's own password, audited as
 * organization.recovered. Staff never see an organisation's inbox here.
 */
export function AdminOrganisations() {
  const [q, setQ] = useState('');
  const [rows, setRows] = useState<OrgRow[] | null>(null);
  const [failure, setFailure] = useState<string | null>(null);

  const load = useCallback(async (query: string) => {
    setFailure(null);
    const response = await fetch(
      `/api/admin/organizations${query ? `?q=${encodeURIComponent(query)}` : ''}`,
      { cache: 'no-store' },
    ).catch(() => null);
    if (!response?.ok) {
      setFailure(
        response ? await errorText(response, 'Could not load.') : 'Could not load.',
      );
      setRows([]);
      return;
    }
    setRows(((await response.json()) as { data: OrgRow[] }).data);
  }, []);

  useEffect(() => {
    void load('');
  }, [load]);

  return (
    <div style={{ display: 'grid', gap: 16 }}>
      <PageHeader
        title="Organisations"
        subtitle="Organisational profiles and their teams. Restore administration only on evidence; every recovery is recorded with your reason."
      />
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void load(q.trim());
        }}
        style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}
      >
        <Input
          aria-label="Search by name"
          placeholder="Search by name"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          style={{ flex: '1 1 200px' }}
        />
        <Button type="submit" variant="secondary">
          Search
        </Button>
      </form>
      {failure ? <Notice kind="error">{failure}</Notice> : null}
      {rows?.length === 0 ? <p className="small muted">No organisations found.</p> : null}
      {rows?.map((org) => (
        <OrgCard key={org.id} org={org} onDone={() => void load(q.trim())} />
      ))}
    </div>
  );
}

function OrgCard({ org, onDone }: { org: OrgRow; onDone: () => void }) {
  const [open, setOpen] = useState(false);
  const [memberId, setMemberId] = useState('');
  const [reason, setReason] = useState('');
  const [evidence, setEvidence] = useState('');
  const [password, setPassword] = useState('');
  const [fields, setFields] = useState<Record<string, string>>({});
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null);

  async function recover(event: React.FormEvent) {
    event.preventDefault();
    const input = { member_id: memberId, reason, evidence, password };
    const parsed = recoverOrganizationSchema.safeParse(input);
    if (!parsed.success) {
      const next: Record<string, string> = {};
      for (const issue of parsed.error.issues) next[String(issue.path[0])] ??= issue.message;
      setFields(next);
      return;
    }
    setFields({});
    const response = await sendJson(
      `/api/admin/organizations/${org.id}/recover`,
      'POST',
      input,
    ).catch(() => null);
    if (!response?.ok) {
      setResult({
        ok: false,
        text: response ? await errorText(response, 'Not restored.') : 'Not restored.',
      });
      return;
    }
    setPassword('');
    setResult({ ok: true, text: 'Administration restored. The person has been told in the app.' });
    onDone();
  }

  return (
    <article
      style={{
        border: '1px solid var(--color-border, #d9d9d9)',
        borderRadius: 8,
        padding: 12,
        display: 'grid',
        gap: 8,
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 }}>
        <strong dir="auto">{org.name}</strong>
        <span className="small">
          {org.closed ? 'Closed' : org.status === 'published' ? 'Published' : 'Draft'} ·{' '}
          {org.administrators} administrator{org.administrators === 1 ? '' : 's'}
        </span>
      </div>
      <ul className="small" style={{ margin: 0, paddingInlineStart: 18 }}>
        {org.members.map((m) => (
          <li key={m.id} dir="auto">
            {m.name} — {m.preset}
            {m.status === 'active'
              ? ''
              : ` (${m.status}${m.end_reason ? `: ${m.end_reason}` : ''})`}
          </li>
        ))}
      </ul>
      {result ? (
        <Notice kind={result.ok ? 'success' : 'error'}>
          <p className="small">{result.text}</p>
        </Notice>
      ) : null}
      {!org.closed ? (
        !open ? (
          <div>
            <Button size="small" variant="secondary" onClick={() => setOpen(true)}>
              Restore administration…
            </Button>
          </div>
        ) : (
          <form onSubmit={(e) => void recover(e)} noValidate style={{ display: 'grid', gap: 8 }}>
            <Field label="Make this person an administrator" error={fields.member_id}>
              {(ids) => (
                <Select {...ids} value={memberId} onChange={(e) => setMemberId(e.target.value)}>
                  <option value="">Choose…</option>
                  {org.members.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.name} ({m.status})
                    </option>
                  ))}
                </Select>
              )}
            </Field>
            <Field label="Reason" error={fields.reason}>
              {(ids) => (
                <Input {...ids} value={reason} onChange={(e) => setReason(e.target.value)} />
              )}
            </Field>
            <Field
              label="Evidence relied on"
              hint="A reference to what you checked, such as a registration document or a signed letter."
              error={fields.evidence}
            >
              {(ids) => (
                <Input {...ids} value={evidence} onChange={(e) => setEvidence(e.target.value)} />
              )}
            </Field>
            <Field label="Your password" error={fields.password}>
              {(ids) => (
                <PasswordInput
                  {...ids}
                  autoComplete="current-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                />
              )}
            </Field>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <Button type="submit" size="small">
                Restore administration
              </Button>
              <Button type="button" size="small" variant="ghost" onClick={() => setOpen(false)}>
                Cancel
              </Button>
            </div>
          </form>
        )
      ) : null}
    </article>
  );
}
