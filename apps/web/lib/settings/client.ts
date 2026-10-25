'use client';

import { useEffect, useState } from 'react';

import {
  SETTING_DEFAULTS,
  type CurrentNotice,
  type NoticeLanguage,
  type PolicyNoticeKind,
  type PublicSettings,
} from '@agri-erp/shared';

/**
 * SETTINGS, PHASE 1 (2026-10-25): the public reads, for the browser.
 *
 * Both fall back to what the site showed before settings existed, so a slow,
 * failed or offline read changes nothing a visitor sees: no support contact,
 * no banner, and the built-in v1.3 consent text.
 */

export const FALLBACK_PUBLIC_SETTINGS: PublicSettings = {
  service_name: SETTING_DEFAULTS.identity.service_name,
  about: SETTING_DEFAULTS.identity.about,
  support: SETTING_DEFAULTS.support,
  maintenance: SETTING_DEFAULTS.maintenance,
  language_region: SETTING_DEFAULTS.language_region,
  reference_lists: SETTING_DEFAULTS.reference_lists,
  appeal_window_days: SETTING_DEFAULTS.notifications_moderation.appeal_window_days,
  suspension_review_days: SETTING_DEFAULTS.notifications_moderation.suspension_review_days,
};

/** One request per page load, shared by the banner, the footer and /help. */
let publicSettingsRequest: Promise<PublicSettings> | null = null;

function loadPublicSettings(): Promise<PublicSettings> {
  publicSettingsRequest ??= fetch('/api/settings/public')
    .then(async (res) => {
      if (!res.ok) return FALLBACK_PUBLIC_SETTINGS;
      const body = (await res.json().catch(() => ({}))) as { data?: PublicSettings };
      return body.data ?? FALLBACK_PUBLIC_SETTINGS;
    })
    .catch(() => FALLBACK_PUBLIC_SETTINGS);
  return publicSettingsRequest;
}

/** The public settings, or null until they have been read (then the fallback on failure). */
export function usePublicSettings(): PublicSettings | null {
  const [settings, setSettings] = useState<PublicSettings | null>(null);
  useEffect(() => {
    let live = true;
    void loadPublicSettings().then((s) => {
      if (live) setSettings(s);
    });
    return () => {
      live = false;
    };
  }, []);
  return settings;
}

/** The text and version the sign-up screens show and record. */
export interface ConsentText {
  /** What the consent records: '<version>-<language>', e.g. 'v1.3-en'. */
  text_version: string;
  body: string;
}

/**
 * The PUBLISHED consent notice in this language, from GET /api/notices/current;
 * `fallback` (the built-in v1.3 text) until it arrives, and if it cannot be
 * read -- offline, or no notice published. Sign-up never waits on it.
 */
export function useConsentText(language: NoticeLanguage, fallback: ConsentText): ConsentText {
  return useNoticeText('consent', language, fallback);
}

/**
 * 2026-10-28 (user journeys): the same read for any notice kind -- the email
 * sign-up shows the published terms of use (`terms`). The fallback is shown
 * until it arrives and whenever it cannot be read; the version shown is the
 * version recorded.
 */
export function useNoticeText(
  kind: PolicyNoticeKind,
  language: NoticeLanguage,
  fallback: ConsentText,
): ConsentText {
  const [fetched, setFetched] = useState<Partial<Record<string, ConsentText>>>({});
  const key = `${kind}:${language}`;
  useEffect(() => {
    if (fetched[key]) return;
    let live = true;
    fetch(`/api/notices/current?kind=${kind}&lang=${language}`)
      .then(async (res) => {
        if (!res.ok) return;
        const body = (await res.json().catch(() => ({}))) as { data?: CurrentNotice };
        const notice = body.data;
        if (!live || !notice?.body || !notice.text_version) return;
        setFetched((prev) => ({
          ...prev,
          [key]: { text_version: notice.text_version, body: notice.body },
        }));
      })
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [kind, language, key, fetched]);
  return fetched[key] ?? fallback;
}

/**
 * 2026-10-27 (settings phase 2): the values a form offers for a NEW entry --
 * every value not archived in Marketplace and reference lists, plus any value
 * the record already holds, so editing an older post never loses it.
 */
export function offered<T extends string>(
  values: readonly T[],
  archived: readonly string[] | undefined,
  ...keep: (string | null | undefined)[]
): T[] {
  if (!archived || archived.length === 0) return [...values];
  return values.filter((v) => !archived.includes(v) || keep.includes(v));
}

/** The archived lists, or none until the public settings arrive. */
export function useArchivedLists(): PublicSettings['reference_lists'] | null {
  return usePublicSettings()?.reference_lists ?? null;
}

/**
 * 2026-10-27 (settings phase 2): whether Arabic is offered (Language and
 * region). True until the settings arrive, and on any failure, as before.
 */
export function useArabicEnabled(): boolean {
  const settings = usePublicSettings();
  return settings?.language_region.enabled_languages.includes('ar') ?? true;
}
