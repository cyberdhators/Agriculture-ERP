/**
 * THE NOTICES A FARMER IS SENT, AND WHERE EACH ONE OPENS (2026-10-10).
 *
 * CORWADO's review of the live system: "there is no option or link a farmer
 * can open to see the details of the buyer, and the produce this buyer is
 * requesting." A notice is stored as a fixed title and a sentence, so the
 * title says which kind it is and this map says where tapping it goes. The
 * server writes these titles (lib/api/buyers.ts, the staff withdraw route);
 * this file has no server imports so the farmer's screens can read it too.
 */

/** Sent when a buyer asks for the farmer's produce. */
export const FARMER_REQUEST_NOTICE = {
  title: 'A buyer wants your produce',
  body: "Tap to see the buyer, the produce they want and the buyer's phone number.",
} as const;

/** Sent when a buyer cancels a request (2026-10-08). */
export const FARMER_CANCEL_NOTICE = {
  title: 'A buyer cancelled a request',
  body: 'Tap to see which one. You no longer need to contact that buyer about it.',
} as const;

/** Sent when staff take a listing off the market (#148). */
export const LISTING_WITHDRAWN_NOTICE_TITLE = 'CORWADO took one of your listings off the market';

/** Where the farmer's requests are shown: the overview, at its requests section. */
export const FARMER_REQUESTS_HREF = '/farmer/account#requests';

/** Where tapping a notice goes, or null for a notice that has nowhere to open. */
export function noticeHref(title: string): string | null {
  if (title === FARMER_REQUEST_NOTICE.title || title === FARMER_CANCEL_NOTICE.title) {
    return FARMER_REQUESTS_HREF;
  }
  if (title === LISTING_WITHDRAWN_NOTICE_TITLE) return '/farmer/account/listings';
  return null;
}
