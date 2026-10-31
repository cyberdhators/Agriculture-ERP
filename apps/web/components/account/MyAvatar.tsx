'use client';

import { useEffect, useState } from 'react';

import { getMyPublicProfile } from '@/lib/public-profile/client';

import css from './settings.module.css';

/**
 * The profile card's picture (2026-10-31, the owner: a photo uploaded on the
 * public profile "shows within profile but doesn't show when you go to
 * account"). The photo lives on the public profile, so this reads it there
 * (GET /api/account/public-profile -- a read, nothing is written) and shows it;
 * until it arrives, or when there is none, the initials stay.
 */
export function MyAvatar({ initials }: { initials: string }) {
  const [url, setUrl] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    getMyPublicProfile()
      .then((profile) => {
        if (live) setUrl(profile.photo_url ?? null);
      })
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, []);

  return (
    <span className={css.avatar} aria-hidden>
      {url ? (
        // A short-lived signed link from private storage: a plain img, as on the profile.
        <img className={css.avatarPhoto} src={url} alt="" onError={() => setUrl(null)} />
      ) : (
        initials
      )}
    </span>
  );
}
