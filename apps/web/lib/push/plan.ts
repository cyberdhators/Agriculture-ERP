import { parseChannel } from '@agri-erp/shared';

import { ACCOUNT_NOTICES, popHref, type AccountNotice } from '../farmer-notices';
import { t, type Language, type TKey } from '../i18n';
import type { RealtimeEvent } from '../realtime/publish';

/**
 * WHAT A PHONE ALERT SAYS AND WHO GETS IT (2026-11-03). No database and no
 * network here, so all of it is tested.
 *
 * THE WORDING IS FIXED. An alert shows on a locked phone that anyone can pick
 * up, so it is built only from fixed i18n sentences: never a stored notice's
 * text (a staff withdrawal stores a reason and a listing's title), never a
 * message, never a name. What it points at is an id in a link to a page that
 * asks for sign-in. Official announcements hold free text and are not sent.
 */

/** A notice the realtime channel does not carry: written by buyers.ts and the withdraw route. */
export interface PushNote {
  farmerId?: string;
  organizationId?: string;
  titleKey: TKey;
  bodyKey: TKey;
  href: string;
  tag: string;
  urgency: Urgency;
}

export type Urgency = 'high' | 'normal';

export interface PushIntent {
  accounts: string[];
  farmers: string[];
  organizations: string[];
  /** The conversation, when an organisation's inbox has to be expanded to its members. */
  conversationId?: string;
  /** Who wrote it: their own phones get no alert. */
  except?: string;
  /** Message alerts follow "activity updates"; notices were already checked when stored. */
  followsUpdates: boolean;
  titleKey: TKey;
  bodyKey: TKey;
  link: { href: string } | { title: string; refKind?: string; refId?: string };
  tag: string;
  urgency: Urgency;
}

export interface Subscriber {
  id: string;
  auth_user_id: string;
  endpoint: string;
  p256dh: string;
  auth: string;
  language: Language;
  side: 'farmer' | 'buyer';
  updates_on: boolean;
}

export interface Alert {
  subscriber: Subscriber;
  urgency: Urgency;
  tag: string;
  payload: { title: string; body: string; href: string; tag: string; lang: Language };
}

const isNotice = (name: string): name is AccountNotice =>
  Object.prototype.hasOwnProperty.call(ACCOUNT_NOTICES, name);

const idsOf = (channels: readonly string[], kind: 'account' | 'organization'): string[] =>
  channels.flatMap((c) => {
    const parsed = parseChannel(c);
    return parsed?.kind === kind ? [parsed.id] : [];
  });

/** Notices come first: a conversation's first message is a notice and a message, and one alert. */
export function intentsFrom(
  events: readonly RealtimeEvent[],
  notes: readonly PushNote[],
): PushIntent[] {
  const notices: PushIntent[] = [];
  const messages: PushIntent[] = [];
  for (const e of events) {
    const data = e.data as unknown as Record<string, string | undefined>;
    if (e.event === 'notification.created') {
      if (!data.notice || !isNotice(data.notice)) continue;
      const notice = ACCOUNT_NOTICES[data.notice];
      const onConversation = data.ref_kind === 'conversation' && data.ref_id;
      notices.push({
        accounts: idsOf(e.channels, 'account'),
        farmers: [],
        organizations: [],
        followsUpdates: false,
        titleKey: `${notice.key}.title` as TKey,
        bodyKey: `${notice.key}.body` as TKey,
        link: { title: notice.title, refKind: data.ref_kind, refId: data.ref_id },
        tag: onConversation ? `conversation-${data.ref_id}` : `notice-${data.notification_id}`,
        urgency: data.kind === 'promotional' ? 'normal' : 'high',
      });
    } else if (e.event === 'message.created' && data.conversation_id) {
      messages.push({
        accounts: idsOf(e.channels, 'account'),
        farmers: [],
        organizations: idsOf(e.channels, 'organization'),
        conversationId: data.conversation_id,
        except: data.sender,
        followsUpdates: true,
        titleKey: 'push.message.title',
        bodyKey: 'push.message.body',
        link: { title: '', refKind: 'conversation', refId: data.conversation_id },
        tag: `conversation-${data.conversation_id}`,
        urgency: 'high',
      });
    }
  }
  const written = notes.map((n): PushIntent => ({
    accounts: [],
    farmers: n.farmerId ? [n.farmerId] : [],
    organizations: n.organizationId ? [n.organizationId] : [],
    followsUpdates: false,
    titleKey: n.titleKey,
    bodyKey: n.bodyKey,
    link: { href: n.href },
    tag: n.tag,
    urgency: n.urgency,
  }));
  return [...notices, ...written, ...messages];
}

/** One alert per phone per tag; the first intent for a tag wins. */
export function alertsFor(
  intent: PushIntent,
  subscribers: readonly Subscriber[],
  seen: Set<string>,
): Alert[] {
  const out: Alert[] = [];
  for (const subscriber of subscribers) {
    if (subscriber.auth_user_id === intent.except) continue;
    if (intent.followsUpdates && !subscriber.updates_on) continue;
    const key = `${subscriber.endpoint}|${intent.tag}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const href =
      'href' in intent.link
        ? intent.link.href
        : popHref({
            side: subscriber.side,
            title: intent.link.title || null,
            refKind: intent.link.refKind,
            refId: intent.link.refId,
          });
    out.push({
      subscriber,
      urgency: intent.urgency,
      tag: intent.tag,
      payload: {
        title: t(intent.titleKey, subscriber.language),
        body: t(intent.bodyKey, subscriber.language),
        href,
        tag: intent.tag,
        lang: subscriber.language,
      },
    });
  }
  return out;
}
