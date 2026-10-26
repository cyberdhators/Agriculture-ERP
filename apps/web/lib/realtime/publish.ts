import { BirdClient } from '@messagebird/sdk';

import {
  REALTIME_PAYLOAD_FIELDS,
  type RealtimeEventName,
  type RealtimePayload,
} from '@agri-erp/shared';

import { realtimeConfig, realtimeSigningConfig, type RealtimeConfig } from './config';

/**
 * PUBLISHING A LIVE UPDATE, SERVER-SIDE ONLY (2026-10-26). docs/DECISIONS.md,
 * "Bird Realtime live updates".
 *
 * NEVER IN THE REQUEST'S WAY. `publishRealtime` never throws and never takes
 * longer than PUBLISH_DEADLINE_MS: a slow or absent Bird must not slow a
 * message send or fail a notice. Routes do not even await it -- they queue
 * events in the request's outbox (outbox.ts), and the wrapper hands the
 * outbox to `after()` once the answer has gone. A lost event costs nothing
 * but freshness: the screens still poll as they always did.
 *
 * IDS ONLY. `cleanPayload` keeps only the field names in
 * REALTIME_PAYLOAD_FIELDS, and only string values, so a body, a title or a
 * name cannot ride an event even by mistake.
 *
 * THE SECRET STAYS HERE. Publishing uses Bird's server SDK, `@messagebird/sdk`
 * (the owner's choice, 2026-10-26), which needs the API key and the app's
 * secret; this module refuses to load in a browser.
 */

if (typeof window !== 'undefined') {
  throw new Error('lib/realtime/publish is server-only and must never be imported by a client.');
}

export const PUBLISH_DEADLINE_MS = 3_000;

/** Bird's limit: one publish names at most 100 channels. */
const MAX_CHANNELS = 100;

export interface RealtimeEvent {
  event: RealtimeEventName;
  channels: string[];
  data: RealtimePayload;
}

const ALLOWED = new Set<string>(REALTIME_PAYLOAD_FIELDS);

/** Only the allowed field names, only string values. */
export function cleanPayload(data: object): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(data)) {
    if (ALLOWED.has(k) && typeof v === 'string' && v.length <= 200) out[k] = v;
  }
  return out;
}

/**
 * Same event and payload to many channels becomes one publish per hundred
 * channels; different payloads stay separate.
 */
export function groupEvents(events: readonly RealtimeEvent[]): RealtimeEvent[] {
  const byPayload = new Map<string, RealtimeEvent>();
  for (const e of events) {
    const data = cleanPayload(e.data);
    const key = `${e.event}|${JSON.stringify(data)}`;
    const group = byPayload.get(key);
    const channels = group ? group.channels : [];
    for (const c of e.channels) if (!channels.includes(c)) channels.push(c);
    if (!group) {
      byPayload.set(key, { event: e.event, channels, data: data as unknown as RealtimePayload });
    }
  }
  const out: RealtimeEvent[] = [];
  for (const g of byPayload.values()) {
    for (let i = 0; i < g.channels.length; i += MAX_CHANNELS) {
      out.push({ ...g, channels: g.channels.slice(i, i + MAX_CHANNELS) });
    }
  }
  return out.filter((e) => e.channels.length > 0);
}

let cached: { client: BirdClient; fingerprint: string } | null = null;

function clientFor(config: RealtimeConfig): BirdClient {
  const fingerprint = `${config.appId}|${config.region}|${config.apiKey.length}|${config.key}`;
  if (cached?.fingerprint !== fingerprint) {
    cached = {
      fingerprint,
      client: new BirdClient({
        apiKey: config.apiKey,
        region: config.region,
        timeout: PUBLISH_DEADLINE_MS,
        maxRetries: 0,
        realtime: { key: config.key, secret: config.secret },
      }),
    };
  }
  return cached.client;
}

/** Test seam: what actually sends one grouped event. */
export type Sender = (config: RealtimeConfig, event: RealtimeEvent) => Promise<unknown>;

const sdkSender: Sender = (config, event) =>
  clientFor(config).realtime.publish(config.appId, {
    event: event.event,
    channels: event.channels,
    data: event.data as unknown as Record<string, unknown>,
  });

/**
 * Publishes, and resolves when done or when the deadline passes. NEVER
 * rejects. Returns how many grouped publishes Bird accepted (for tests and
 * logs; nobody branches on it).
 */
export async function publishRealtime(
  events: readonly RealtimeEvent[],
  options: { config?: RealtimeConfig | null; send?: Sender; deadlineMs?: number } = {},
): Promise<number> {
  try {
    const config = options.config === undefined ? realtimeConfig() : options.config;
    if (!config || events.length === 0) return 0;
    const send = options.send ?? sdkSender;
    const grouped = groupEvents(events);
    let accepted = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;
    await Promise.race([
      Promise.allSettled(
        grouped.map((e) =>
          Promise.resolve()
            .then(() => send(config, e))
            .then(() => {
              accepted += 1;
            }),
        ),
      ),
      new Promise<void>((resolve) => {
        timer = setTimeout(resolve, options.deadlineMs ?? PUBLISH_DEADLINE_MS);
      }),
    ]);
    clearTimeout(timer);
    return accepted;
  } catch {
    return 0;
  }
}

/**
 * Signs one subscription for the browser client, with the SDK's own helper:
 * HMAC-SHA256 over `<connection_id>:<channel_name>[:<member_data>]` with the
 * app secret, prefixed with the app key. No network call.
 */
export async function signChannel(input: {
  connectionId: string;
  channelName: string;
  memberData?: string;
}): Promise<{ auth: string; member_data?: string } | null> {
  const signing = realtimeSigningConfig();
  if (!signing) return null;
  // 2026-11-01 (live test): the SDK refuses to construct a client without an
  // API key ("Configure `apiKey` for API calls"), even though signing makes no
  // network call -- every channel authorization answered 500 in production.
  // realtimeConfig already falls back to BIRD_API_KEY; the key itself is read
  // in lib/sms/bird.ts alone (tests/provider-secrets).
  const apiKey = realtimeConfig()?.apiKey ?? '';
  if (!apiKey) return null;
  const client = new BirdClient({ apiKey, realtime: signing });
  const signed = await client.realtime.authorizeChannel({
    connectionId: input.connectionId,
    channelName: input.channelName,
    ...(input.memberData !== undefined ? { memberData: input.memberData } : {}),
  });
  return signed.member_data !== undefined
    ? { auth: signed.auth, member_data: signed.member_data }
    : { auth: signed.auth };
}

/**
 * The presence channels that are occupied right now: which accounts have the
 * app open. One request, cached for ONLINE_CACHE_MS per server instance, and
 * an empty set on any failure (then everyone simply reads as "last active").
 */
export const ONLINE_CACHE_MS = 10_000;
let online: { at: number; names: Set<string> } | null = null;

export async function occupiedPresenceChannels(prefix: string): Promise<Set<string>> {
  const config = realtimeConfig();
  if (!config) return new Set();
  if (online && Date.now() - online.at < ONLINE_CACHE_MS) return online.names;
  try {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const result = await Promise.race([
      clientFor(config).realtime.channels.list(config.appId, { prefix }),
      new Promise<null>((resolve) => {
        timer = setTimeout(() => resolve(null), 1_500);
      }),
    ]);
    clearTimeout(timer);
    const list = (result as { data?: { name: string }[] } | null)?.data;
    if (!list) return online?.names ?? new Set();
    online = { at: Date.now(), names: new Set(list.map((c) => c.name)) };
    return online.names;
  } catch {
    return online?.names ?? new Set();
  }
}
