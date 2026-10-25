'use client';

import { useEffect, useState } from 'react';

import type { ActingAs, MyOrganization } from '@agri-erp/shared';

import { Notice } from '@/components/ui';

import { TEAM_WORDS, sendJson, type Lang } from './words';

/**
 * "Acting as" (2026-10-27, team access). Shown only to a person who belongs to
 * at least one open organisation. Choosing one sets the acting cookie through
 * POST /api/organizations/acting -- which checks the membership, as every
 * later request checks it again -- and reloads, so the inbox, "my" posts and
 * new posts all follow the choice. Phone width: one labelled select.
 */
export function ActingAsBar({ language = 'en' }: { language?: Lang }) {
  const w = TEAM_WORDS[language];
  const [orgs, setOrgs] = useState<MyOrganization[]>([]);
  const [acting, setActing] = useState<(ActingAs & { access_ended?: boolean }) | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let live = true;
    void (async () => {
      const [list, current] = await Promise.all([
        fetch('/api/organizations', { cache: 'no-store' }).catch(() => null),
        fetch('/api/organizations/acting', { cache: 'no-store' }).catch(() => null),
      ]);
      if (!live) return;
      if (list?.ok) {
        const body = (await list.json()) as { data: MyOrganization[] };
        setOrgs(body.data.filter((o) => !o.closed));
      }
      if (current?.ok) setActing(((await current.json()) as { data: ActingAs }).data);
    })();
    return () => {
      live = false;
    };
  }, []);

  if (orgs.length === 0 && !acting?.access_ended) return null;

  async function choose(value: string) {
    setBusy(true);
    const response = await sendJson('/api/organizations/acting', 'POST', {
      organization_id: value === '' ? null : value,
    }).catch(() => null);
    if (response?.ok) window.location.reload();
    else setBusy(false);
  }

  return (
    <div
      style={{
        display: 'flex',
        flexWrap: 'wrap',
        alignItems: 'center',
        gap: 8,
        padding: '8px 12px',
        marginBottom: 12,
        borderRadius: 8,
        background: acting?.organization_id ? 'var(--color-nile-50, #eef5fb)' : 'transparent',
        border: '1px solid var(--color-border, #d9d9d9)',
      }}
    >
      {acting?.access_ended ? (
        <Notice kind="warn">
          <p className="small">{w.accessEnded}</p>
        </Notice>
      ) : null}
      <label htmlFor="acting-as" className="small" style={{ fontWeight: 600 }}>
        {w.actingAs}
      </label>
      <select
        id="acting-as"
        value={acting?.organization_id ?? ''}
        disabled={busy}
        onChange={(e) => void choose(e.target.value)}
        style={{ minWidth: 0, flex: '1 1 160px', maxWidth: '100%' }}
      >
        <option value="">{w.yourself}</option>
        {orgs.map((o) => (
          <option key={o.id} value={o.id}>
            {o.name}
          </option>
        ))}
      </select>
      {acting?.organization_id ? (
        <p className="small muted" style={{ margin: 0, flexBasis: '100%' }}>
          {w.actingNote}
        </p>
      ) : null}
    </div>
  );
}
