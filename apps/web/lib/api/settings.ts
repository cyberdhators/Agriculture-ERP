import {
  SETTING_KEYS,
  readSetting,
  type PolicyNoticeKind,
  type NoticeLanguage,
  type PublicSettings,
  type SettingKey,
  type SettingValues,
  type StaffNotice,
  consentTextVersion,
} from '@agri-erp/shared';

import { prisma } from '../db';

/**
 * SETTINGS, PHASE 1 (2026-10-25): the reads the settings routes share.
 * docs/DECISIONS.md, "Settings, phase 1".
 *
 * The current value of a setting is its HIGHEST version in setting_version;
 * nothing is ever overwritten. A key never saved reads as its fallback
 * (SETTING_DEFAULTS), which is what the service showed before this existed.
 *
 * NOTHING THAT WORKS TODAY MAY STOP WORKING. Until migration 20261025100000 is
 * applied the tables do not exist; the public reads ask for them first, in a
 * form that cannot fail, and answer with the fallbacks, so the help page, the
 * footer and the sign-up screens behave exactly as before.
 */

type Queryable = { $queryRawUnsafe: <T>(sql: string, ...p: unknown[]) => Promise<T> };

export interface CurrentSetting<K extends SettingKey = SettingKey> {
  key: K;
  /** 0 when the key was never saved and the fallback is shown. */
  version: number;
  value: SettingValues[K];
  changed_at: string | null;
  /** The staff member's name; null for a seeded or never-saved value. */
  changed_by: string | null;
}

interface SettingRow {
  key: SettingKey;
  version: number;
  value: unknown;
  changed_at: Date;
  changed_by: string | null;
}

const LATEST_SQL = `
  SELECT DISTINCT ON (s.key) s.key, s.version, s.value, s.changed_at, u.name AS changed_by
    FROM public.setting_version s
    LEFT JOIN public."user" u ON u.id = s.changed_by
   WHERE s.key = ANY ($1::text[])
   ORDER BY s.key, s.version DESC`;

const present = <K extends SettingKey>(key: K, row: SettingRow | undefined): CurrentSetting<K> => ({
  key,
  version: row?.version ?? 0,
  value: readSetting(key, row?.value),
  changed_at: row ? row.changed_at.toISOString() : null,
  changed_by: row?.changed_by ?? null,
});

/** Whether migration 20261025100000 has been applied. Cannot fail. */
export async function settingsTablesPresent(client: Queryable = prisma): Promise<boolean> {
  const [row] = await client.$queryRawUnsafe<{ present: boolean }[]>(
    `SELECT to_regclass('public.setting_version') IS NOT NULL
        AND to_regclass('public.notice') IS NOT NULL AS present`,
  );
  return row?.present === true;
}

/** Every setting, current version, with its fallback where never saved. */
export async function currentSettings(client: Queryable = prisma): Promise<CurrentSetting[]> {
  const rows = await client.$queryRawUnsafe<SettingRow[]>(LATEST_SQL, [...SETTING_KEYS]);
  return SETTING_KEYS.map((key) =>
    present(
      key,
      rows.find((r) => r.key === key),
    ),
  );
}

/** One setting, current version. Pass a transaction client to read under its lock. */
export async function currentSetting<K extends SettingKey>(
  key: K,
  client: Queryable = prisma,
): Promise<CurrentSetting<K>> {
  const rows = await client.$queryRawUnsafe<SettingRow[]>(LATEST_SQL, [key]);
  return present(key, rows[0]);
}

/**
 * What a visitor's page needs: the service name, About, support contacts and
 * help links, and the maintenance banner. A whitelist: no version, no staff
 * name, no reason code.
 */
export async function publicSettings(): Promise<PublicSettings> {
  const value = <K extends SettingKey>(all: CurrentSetting[], key: K) =>
    (all.find((s) => s.key === key) as CurrentSetting<K> | undefined)?.value ??
    readSetting(key, undefined);
  const all = (await settingsTablesPresent()) ? await currentSettings() : [];
  const identity = value(all, 'identity');
  return {
    service_name: identity.service_name,
    about: identity.about,
    support: value(all, 'support'),
    maintenance: value(all, 'maintenance'),
  };
}

// ---------------------------------------------------------------------------
// NOTICES
// ---------------------------------------------------------------------------

export interface NoticeRow {
  id: string;
  kind: PolicyNoticeKind;
  language: NoticeLanguage;
  version: string;
  body: string;
  status: StaffNotice['status'];
  created_at: Date;
  updated_at: Date;
  published_at: Date | null;
  retired_at: Date | null;
}

export const NOTICE_SELECT = `
  SELECT n.id, n.kind, n.language::text AS language, n.version, n.body, n.status,
         n.created_at, n.updated_at, n.published_at, n.retired_at
    FROM public.notice n`;

export const presentNotice = (row: NoticeRow): StaffNotice => ({
  id: row.id,
  kind: row.kind,
  language: row.language,
  version: row.version,
  text_version: consentTextVersion(row.version, row.language),
  body: row.body,
  status: row.status,
  created_at: row.created_at.toISOString(),
  updated_at: row.updated_at.toISOString(),
  published_at: row.published_at ? row.published_at.toISOString() : null,
  retired_at: row.retired_at ? row.retired_at.toISOString() : null,
});

// ---------------------------------------------------------------------------
// SECURITY AND OPERATIONS -- read-only status, NEVER a secret
// ---------------------------------------------------------------------------

/**
 * The integrations in use and the environment variable NAMES each one reads.
 * The status screen reports, per name, only whether it is set: a boolean. No
 * value, no length, no prefix leaves the server. Mapbox is listed with no
 * variable because no code reads one yet (the map is hidden; DECISIONS).
 */
export const INTEGRATIONS: ReadonlyArray<{
  name: string;
  purpose: string;
  variables: readonly string[];
}> = [
  {
    name: 'Supabase',
    purpose: 'Sign-in and file storage',
    variables: [
      'NEXT_PUBLIC_SUPABASE_URL',
      'NEXT_PUBLIC_SUPABASE_ANON_KEY',
      'SUPABASE_SERVICE_ROLE_KEY',
    ],
  },
  { name: 'Database', purpose: 'Postgres connection', variables: ['DATABASE_URL', 'DIRECT_URL'] },
  {
    name: 'Bird',
    purpose: 'SMS',
    variables: ['BIRD_API_KEY', 'BIRD_API_BASE_URL', 'BIRD_SMS_SENDER_ID'],
  },
  { name: 'Resend', purpose: 'Email', variables: ['RESEND_API_KEY', 'EMAIL_FROM'] },
  { name: 'OpenWeather', purpose: 'Weather forecasts', variables: ['OPENWEATHER_API_KEY'] },
  { name: 'Anthropic', purpose: 'AgriOne AI', variables: ['ANTHROPIC_API_KEY'] },
  {
    name: 'Sentry',
    purpose: 'Error reporting',
    variables: ['NEXT_PUBLIC_SENTRY_DSN', 'SENTRY_ENVIRONMENT'],
  },
  { name: 'Scheduler', purpose: 'Hourly weather fetch', variables: ['CRON_SECRET'] },
  { name: 'Mapbox', purpose: 'Farm maps (hidden for now)', variables: [] },
];

export interface IntegrationStatus {
  name: string;
  purpose: string;
  /** Every listed variable is set. False when the integration lists none. */
  configured: boolean;
  variables: { name: string; present: boolean }[];
}

/** Presence only. `env` is injectable so the test needs no real environment. */
export function integrationStatus(
  env: Readonly<Record<string, string | undefined>> = process.env,
): IntegrationStatus[] {
  return INTEGRATIONS.map((integration) => {
    const variables = integration.variables.map((name) => ({
      name,
      present: typeof env[name] === 'string' && (env[name] ?? '').trim() !== '',
    }));
    return {
      name: integration.name,
      purpose: integration.purpose,
      configured: variables.length > 0 && variables.every((v) => v.present),
      variables,
    };
  });
}

/**
 * Staff with a verified authenticator-app factor, from Supabase Auth's own
 * table. A count, never a name. If that table cannot be read by this
 * connection, the answer is "not tracked" rather than a guess.
 */
export async function staffMfaStatus(): Promise<
  { tracked: true; staff: number; with_mfa: number } | { tracked: false }
> {
  try {
    const [present] = await prisma.$queryRawUnsafe<{ present: boolean }[]>(
      `SELECT to_regclass('auth.mfa_factors') IS NOT NULL AS present`,
    );
    if (!present?.present) return { tracked: false };
    const [row] = await prisma.$queryRawUnsafe<{ staff: number; with_mfa: number }[]>(
      `SELECT count(*)::int AS staff,
              count(*) FILTER (WHERE EXISTS (
                SELECT 1 FROM auth.mfa_factors f
                 WHERE f.user_id = u.auth_user_id
                   AND f.factor_type = 'totp' AND f.status = 'verified'
              ))::int AS with_mfa
         FROM public.user_active u`,
    );
    return row ? { tracked: true, staff: row.staff, with_mfa: row.with_mfa } : { tracked: false };
  } catch {
    return { tracked: false };
  }
}
