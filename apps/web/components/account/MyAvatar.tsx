'use client';

import { useEffect, useState } from 'react';

import { getMyPublicProfile } from '@/lib/public-profile/client';

import css from './settings.module.css';

interface PublicFace {
  photoUrl: string | null;
  displayName: string | null;
}

/**
 * One read of the caller's own public profile, shared by the avatar and the
 * "shown publicly as" line on the same screen (GET /api/account/public-profile;
 * a read, nothing is written). Kept for a few seconds only, so a name or photo
 * saved on the profile shows the next time Account opens.
 */
let cached: { at: number; promise: Promise<PublicFace> } | null = null;

function loadFace(): Promise<PublicFace> {
  if (cached && Date.now() - cached.at < 10_000) return cached.promise;
  const promise = getMyPublicProfile()
    .then((profile) => ({
      photoUrl: profile.photo_url ?? null,
      displayName: profile.display_name ?? null,
    }))
    .catch(() => ({ photoUrl: null, displayName: null }));
  cached = { at: Date.now(), promise };
  return promise;
}

function usePublicFace(): PublicFace {
  const [face, setFace] = useState<PublicFace>({ photoUrl: null, displayName: null });
  useEffect(() => {
    let live = true;
    void loadFace().then((f) => {
      if (live) setFace(f);
    });
    return () => {
      live = false;
    };
  }, []);
  return face;
}

/**
 * The profile card's picture (2026-10-31, the owner: a photo uploaded on the
 * public profile "shows within profile but doesn't show when you go to
 * account"). Until it arrives, or when there is none, the initials stay.
 */
export function MyAvatar({ initials }: { initials: string }) {
  const { photoUrl } = usePublicFace();
  const [broken, setBroken] = useState(false);
  return (
    <span className={css.avatar} aria-hidden>
      {photoUrl && !broken ? (
        // A short-lived signed link from private storage: a plain img, as on the profile.
        <img className={css.avatarPhoto} src={photoUrl} alt="" onError={() => setBroken(true)} />
      ) : (
        initials
      )}
    </span>
  );
}

/**
 * 2026-10-31 (the owner: "edited my name ... saved to profile but not to
 * account"): the record name is fixed after sign-up; the public profile's name
 * is the member's to choose (often a farm or business). When the two differ,
 * the card says what the public sees.
 */
export function PublicNameLine({
  recordName,
  language,
}: {
  recordName: string;
  language: 'en' | 'ar';
}) {
  const { displayName } = usePublicFace();
  const shown = displayName?.trim();
  if (!shown || shown === recordName.trim()) return null;
  return (
    <span className={css.profileMeta}>
      <span>
        {language === 'ar' ? 'يظهر للعامة باسم: ' : 'Shown publicly as: '}
        <bdi>{shown}</bdi>
      </span>
    </span>
  );
}
