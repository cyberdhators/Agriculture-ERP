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

/**
 * NOTICES TO AN ACCOUNT (2026-10-26, CORWADO's acceptance test of 24 October:
 * "Notify relevant users of inquiries, case updates, invitations and account
 * actions ... avoid exposing private case details in notification previews").
 *
 * Every one is a FIXED sentence. None carries a message's text, an advice
 * request's text, a staff reason or anybody's name: a notice can be seen on a
 * shared phone's screen, so it says only that something happened and where to
 * look. The reason for an adviser decision is on the Offer advice page; the
 * message is in Messages; the case is in Advice. Written by lib/api/notify.ts.
 * The `key` is the i18n key the farmer's screen shows in their language.
 */
export const ACCOUNT_NOTICES = {
  adviser_clarification_requested: {
    title: 'CORWADO has a question about your adviser application',
    body: 'Open Offer advice to read the question and reply.',
    key: 'notice.adviserClarification',
  },
  adviser_approved: {
    title: 'You are now an approved adviser',
    body: 'Your advice profile now shows the approved-adviser badge.',
    key: 'notice.adviserApproved',
  },
  adviser_declined: {
    title: 'Your adviser application was not approved',
    body: 'Open Offer advice to see the reason.',
    key: 'notice.adviserDeclined',
  },
  adviser_revoked: {
    title: 'Your approved-adviser status was removed',
    body: 'Open Offer advice to see the reason.',
    key: 'notice.adviserRevoked',
  },
  // 2026-10-28: an approval paused, and given back; an official note reviewed.
  adviser_suspended: {
    title: 'Your approved-adviser status was suspended for a time',
    body: 'Open Offer advice to see the reason and when it ends.',
    key: 'notice.adviserSuspended',
  },
  adviser_restored: {
    title: 'Your approved-adviser status was restored',
    body: 'Your advice profile shows the approved-adviser badge again.',
    key: 'notice.adviserRestored',
  },
  advisory_note_reviewed: {
    title: 'CORWADO reviewed one of your advisory notes',
    body: 'Open Offer advice to see where it stands.',
    key: 'notice.advisoryNoteReviewed',
  },
  account_restored: {
    title: 'Your AgriOne account has been restored',
    body: 'You can sign in and use AgriOne again.',
    key: 'notice.accountRestored',
  },
  message_listing: {
    title: 'You have a new message about a product listing',
    body: 'Open Messages to read it.',
    key: 'notice.messageListing',
  },
  message_buying_request: {
    title: 'You have a new message about a buying request',
    body: 'Open Messages to read it.',
    key: 'notice.messageBuyingRequest',
  },
  message_service: {
    title: 'You have a new message about a service',
    body: 'Open Messages to read it.',
    key: 'notice.messageService',
  },
  message_advice_case: {
    title: 'You have a new message about an advice request',
    body: 'Open Messages to read it.',
    key: 'notice.messageAdviceCase',
  },
  advice_request_updated: {
    title: 'Your advice request was updated',
    body: 'Open Advice to see what changed.',
    key: 'notice.adviceUpdated',
  },
  advice_work_updated: {
    title: 'An advice request you are handling was updated',
    body: 'Open My advisory work to see what changed.',
    key: 'notice.adviceWorkUpdated',
  },
  advice_referral_proposed: {
    title: 'Another adviser is suggested for your advice request',
    body: 'Open Advice to accept or decline the suggestion.',
    key: 'notice.adviceReferral',
  },
  // TEAM ACCESS (2026-10-27)
  organization_invitation: {
    title: 'You have been invited to join an organisation',
    body: 'Open Organisations in your account to see the role and accept or decline.',
    key: 'notice.orgInvitation',
  },
  organization_transfer_offered: {
    title: 'You have been offered administration of an organisation',
    body: 'Open Organisations in your account to accept or decline.',
    key: 'notice.orgTransfer',
  },
  organization_access_ended: {
    title: 'Your access to an organisation has ended',
    body: 'Your own account is not affected. Open Organisations to see your memberships.',
    key: 'notice.orgAccessEnded',
  },
  organization_recovered: {
    title: 'CORWADO made you an administrator of an organisation',
    body: 'Open Organisations in your account to manage its team.',
    key: 'notice.orgRecovered',
  },
  // 2026-10-27: self-service recovery and a verified change of number.
  password_recovered: {
    title: 'Your AgriOne password was changed',
    body: 'It was reset with a code sent to your phone. If this was not you, contact CORWADO.',
    key: 'notice.passwordRecovered',
  },
  phone_changed: {
    title: 'The phone number on your account was changed',
    body: 'Sign in with the new number from now on. If this was not you, contact CORWADO.',
    key: 'notice.phoneChanged',
  },
  // 2026-10-27: a moderator asks for a correction. The note is on the post, never here.
  listing_correction_requested: {
    title: 'CORWADO asked you to correct one of your posts',
    body: 'Open your listings to see what to change. The post stays on the market meanwhile.',
    key: 'notice.correctionRequested',
  },
} as const;

export type AccountNotice = keyof typeof ACCOUNT_NOTICES;

/** The i18n key prefix of a stored notice title, or null for an older notice shown as stored. */
export function noticeKey(title: string): string | null {
  for (const notice of Object.values(ACCOUNT_NOTICES)) {
    if (notice.title === title) return notice.key;
  }
  return null;
}

/** Where the farmer's requests are shown: the overview, at its requests section. */
export const FARMER_REQUESTS_HREF = '/farmer/account#requests';

/** Where tapping a notice goes, or null for a notice that has nowhere to open. */
export function noticeHref(title: string): string | null {
  if (title === FARMER_REQUEST_NOTICE.title || title === FARMER_CANCEL_NOTICE.title) {
    return FARMER_REQUESTS_HREF;
  }
  if (title === LISTING_WITHDRAWN_NOTICE_TITLE) return '/farmer/account/listings';
  const n = ACCOUNT_NOTICES;
  if (
    title === n.adviser_clarification_requested.title ||
    title === n.adviser_approved.title ||
    title === n.adviser_declined.title ||
    title === n.adviser_revoked.title ||
    title === n.adviser_suspended.title ||
    title === n.adviser_restored.title ||
    title === n.advisory_note_reviewed.title
  ) {
    return '/farmer/account/advice/offer';
  }
  if (
    title === n.message_listing.title ||
    title === n.message_buying_request.title ||
    title === n.message_service.title ||
    title === n.message_advice_case.title
  ) {
    return '/farmer/account/messages';
  }
  if (title === n.advice_request_updated.title || title === n.advice_referral_proposed.title) {
    return '/farmer/account/advice/requests';
  }
  if (title === n.advice_work_updated.title) return '/farmer/account/advice/work';
  if (
    title === n.organization_invitation.title ||
    title === n.organization_transfer_offered.title ||
    title === n.organization_access_ended.title ||
    title === n.organization_recovered.title
  ) {
    return '/farmer/account/organisations';
  }
  if (title === n.password_recovered.title || title === n.phone_changed.title) {
    return '/farmer/account/security';
  }
  if (title === n.listing_correction_requested.title) return '/farmer/account/listings';
  return null;
}
