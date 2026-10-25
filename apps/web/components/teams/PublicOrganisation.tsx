'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';

import { ABOUT_LABELS } from '@/components/account/AccountActivities';
import { Notice } from '@/components/ui';

interface Profile {
  id: string;
  name: string;
  profile_kind: string;
  group_kind: string | null;
  activities: string[];
  about: string | null;
  state_name: string | null;
  location: string | null;
  public_phone: string | null;
  public_email: string | null;
  team: { name: string; title: string | null; role: string }[];
  services: { id: string; title: string; location: string }[];
  buying_requests: { id: string; product_name: string; location: string }[];
}

/**
 * /organisations/:id -- an organisation's public profile (2026-10-27). What
 * GET /api/organizations/:id/profile returns, and nothing else: no member is
 * shown who did not agree, no contact the organisation did not give.
 * Messages go through its posts, to its shared inbox.
 */
export function PublicOrganisation({ id }: { id: string }) {
  const labels = ABOUT_LABELS.en as Record<string, string>;
  const [profile, setProfile] = useState<Profile | null | 'missing'>(null);

  useEffect(() => {
    void fetch(`/api/organizations/${id}/profile`, { cache: 'no-store' })
      .then(async (r) => (r.ok ? ((await r.json()) as { data: Profile }).data : 'missing'))
      .catch(() => 'missing' as const)
      .then(setProfile);
  }, [id]);

  if (profile === null) return <p className="small muted">…</p>;
  if (profile === 'missing') {
    return <Notice kind="error">This organisation profile is not available.</Notice>;
  }
  const kind = profile.group_kind ? labels[profile.group_kind] : labels[profile.profile_kind];
  const where = [profile.location, profile.state_name].filter(Boolean).join(', ');

  return (
    <main
      id="main"
      style={{ maxWidth: 760, margin: '0 auto', padding: '24px 16px', display: 'grid', gap: 16 }}
    >
      <header>
        <h1 style={{ margin: 0 }} dir="auto">
          {profile.name}
        </h1>
        <p className="small muted" style={{ margin: 0 }}>
          {kind}
          {where ? ` · ${where}` : ''}
        </p>
        {profile.activities.length > 0 ? (
          <p className="small" style={{ margin: 0 }}>
            {profile.activities.map((a) => labels[a] ?? a).join(' · ')}
          </p>
        ) : null}
      </header>
      {profile.about ? (
        <p dir="auto" style={{ whiteSpace: 'pre-wrap', margin: 0 }}>
          {profile.about}
        </p>
      ) : null}
      {profile.public_phone || profile.public_email ? (
        <section>
          <h2>Contact</h2>
          {profile.public_phone ? <p className="mono">{profile.public_phone}</p> : null}
          {profile.public_email ? <p>{profile.public_email}</p> : null}
        </section>
      ) : null}
      {profile.team.length > 0 ? (
        <section>
          <h2>Team</h2>
          <ul>
            {profile.team.map((m, i) => (
              <li key={i} dir="auto">
                {m.name}
                {m.title ? ` — ${m.title}` : ''} ({m.role})
              </li>
            ))}
          </ul>
        </section>
      ) : null}
      {profile.services.length > 0 ? (
        <section>
          <h2>Services</h2>
          <ul>
            {profile.services.map((s) => (
              <li key={s.id}>
                <Link href={`/market/services/${s.id}`}>{s.title}</Link> · {s.location}
              </li>
            ))}
          </ul>
        </section>
      ) : null}
      {profile.buying_requests.length > 0 ? (
        <section>
          <h2>Buying requests</h2>
          <ul>
            {profile.buying_requests.map((b) => (
              <li key={b.id}>
                <Link href={`/market/requests/${b.id}`}>{b.product_name}</Link> ·{' '}
                {b.location}
              </li>
            ))}
          </ul>
        </section>
      ) : null}
      <p className="small muted">
        Public profiles are published by their owners. A profile on AgriOne is not an endorsement
        by CORWADO.
      </p>
    </main>
  );
}
