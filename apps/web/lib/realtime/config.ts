/**
 * BIRD REALTIME CONFIGURATION, SERVER-SIDE ONLY (2026-10-26).
 *
 * Read on every call (as lib/sms/bird.ts does), so adding the settings to a
 * deployment needs no restart and a test can set and unset them. Missing
 * settings are not an error anywhere: without them `realtimeConfig()` is
 * null, nothing is published, the screens are told `enabled: false`, and
 * everything works as it did before -- by polling and page refresh.
 *
 * Names only, never values, ever leave this module (`realtimeProblems`).
 */

if (typeof window !== 'undefined') {
  throw new Error('lib/realtime/config is server-only and must never be imported by a client.');
}

export interface RealtimeConfig {
  /** The Realtime app (`rap_…`). */
  appId: string;
  /** The app's public key (the same value the browser connects with). */
  key: string;
  /** The app's secret: signs channel authorizations and authenticates publishes. */
  secret: string;
  /** A Bird API key with the `realtime:write` scope (publishing needs one). */
  apiKey: string;
  /** us1 or eu1: the region the app and the API key live in. */
  region: string;
}

const REGION = /^[a-z]{2}[0-9]+$/;

/** The settings that are missing or malformed, by NAME. Empty when configured. */
export function realtimeProblems(env: NodeJS.ProcessEnv = process.env): string[] {
  const problems: string[] = [];
  if (!env.BIRD_REALTIME_APP_ID?.startsWith('rap_')) problems.push('BIRD_REALTIME_APP_ID');
  if (!env.NEXT_PUBLIC_BIRD_REALTIME_KEY) problems.push('NEXT_PUBLIC_BIRD_REALTIME_KEY');
  if (!env.BIRD_REALTIME_SECRET) problems.push('BIRD_REALTIME_SECRET');
  if (!(env.BIRD_REALTIME_API_KEY || env.BIRD_API_KEY)) problems.push('BIRD_REALTIME_API_KEY');
  if (!REGION.test(regionOf(env))) problems.push('BIRD_REALTIME_REGION');
  return problems;
}

/** The region: stated, or read from the API key's `bk_<region>_` prefix. */
function regionOf(env: NodeJS.ProcessEnv): string {
  const stated = (env.BIRD_REALTIME_REGION ?? '').trim();
  if (stated) return stated;
  const key = env.BIRD_REALTIME_API_KEY || env.BIRD_API_KEY || '';
  return /^b[km]_([a-z]{2}[0-9]+)_/.exec(key)?.[1] ?? '';
}

export function realtimeConfig(env: NodeJS.ProcessEnv = process.env): RealtimeConfig | null {
  if (realtimeProblems(env).length > 0) return null;
  return {
    appId: env.BIRD_REALTIME_APP_ID as string,
    key: env.NEXT_PUBLIC_BIRD_REALTIME_KEY as string,
    secret: env.BIRD_REALTIME_SECRET as string,
    apiKey: (env.BIRD_REALTIME_API_KEY || env.BIRD_API_KEY) as string,
    region: regionOf(env),
  };
}

/**
 * Channel authorization needs only the key and the secret (no API call), so
 * a deployment whose API key still lacks `realtime:write` can already
 * connect: the screens subscribe, nothing is published until the key is
 * fixed, and polling carries on meanwhile.
 */
export function realtimeSigningConfig(
  env: NodeJS.ProcessEnv = process.env,
): { key: string; secret: string } | null {
  const key = env.NEXT_PUBLIC_BIRD_REALTIME_KEY ?? '';
  const secret = env.BIRD_REALTIME_SECRET ?? '';
  return key && secret ? { key, secret } : null;
}
