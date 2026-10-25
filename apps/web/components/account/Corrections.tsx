'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';

import type { CorrectionTarget, ListingCorrection } from '@agri-erp/shared';

import { Notice, Stamp } from '@/components/ui';
import { t, type Language } from '@/lib/i18n';

/**
 * A MODERATOR'S CORRECTION REQUESTS, AS THEIR OWNER SEES THEM (2026-10-27).
 *
 * GET /api/account/corrections returns the open requests on this account's
 * own posts, each with its reason and the moderator's note. A list screen
 * shows the ones for its kind of post in a notice at the top (what to fix,
 * and a link to edit) and a "Correction requested" stamp on each such post.
 * Editing the post marks the request addressed on the server; the stamp goes
 * at the next load. If the list cannot be read, nothing is shown.
 */
export function useOpenCorrections(type: CorrectionTarget): {
  items: ListingCorrection[];
  ids: ReadonlySet<string>;
} {
  const [items, setItems] = useState<ListingCorrection[]>([]);
  useEffect(() => {
    let live = true;
    void fetch('/api/account/corrections', { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : null))
      .then((b: { data?: ListingCorrection[] } | null) => {
        if (live && b?.data) setItems(b.data.filter((c) => c.target_type === type));
      })
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [type]);
  const ids = useMemo(() => new Set(items.map((c) => c.target_id)), [items]);
  return { items, ids };
}

/** The stamp on a post its owner has been asked to correct. */
export function CorrectionStamp({ lang }: { lang: Language }) {
  return <Stamp kind="escalated">{t('correction.badge', lang)}</Stamp>;
}

/** What to fix on each post, with a link to edit it. Nothing when there is nothing open. */
export function CorrectionNotice({
  items,
  lang,
  editHref,
}: {
  items: readonly ListingCorrection[];
  lang: Language;
  editHref: (targetId: string) => string;
}) {
  if (items.length === 0) return null;
  return (
    <Notice kind="warn" title={t('correction.title', lang)}>
      <p className="small">{t('correction.lead', lang)}</p>
      <ul style={{ margin: 0, paddingInlineStart: '1.2em', display: 'grid', gap: 'var(--s-2)' }}>
        {items.map((c) => (
          <li key={c.id} className="small">
            <strong dir="auto">
              {c.target_title ?? t(`correction.kind.${c.target_type}`, lang)}
            </strong>
            {' — '}
            {t('correction.reason', lang)}: {c.reason_label}
            <span style={{ display: 'block' }} dir="auto">
              {c.note}
            </span>
            <Link href={editHref(c.target_id)}>{t('correction.edit', lang)}</Link>
          </li>
        ))}
      </ul>
    </Notice>
  );
}
