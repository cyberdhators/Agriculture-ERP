import { ERROR_CODES, SYNC_OUTCOMES, type SyncOutcome } from '@agri-erp/shared';

/**
 * WHAT WENT WRONG, AND WHAT THE OFFICER CAN DO ABOUT IT.
 *
 * THE NAMES ARE THE CONTRACT'S, THE SENTENCES ARE NOT.
 * `SYNC_OUTCOMES` in packages/shared is the project's recovery vocabulary
 * (C-9.15) and this reuses it rather than inventing a second one. Its
 * SENTENCES are not reused, and that is deliberate: they are written for the
 * Android application and say things like "Your records are safe on this
 * phone and will send when it can". On the web that is FALSE -- there is no
 * queue, nothing is stored, and a failed submission is still only in the form
 * in front of the officer. Repeating those words here would be a comfortable
 * lie about where the work is.
 *
 * WHAT THIS CANNOT DO, AND WHY. The error body is `{code, message, fields}`
 * (CONVENTIONS §4). `conflict(rule)` and `unprocessable(rule)` put the RULE'S
 * SENTENCE in `message` and the code stays the generic `conflict` or
 * `unprocessable` -- the rule KEY never reaches the client. So a screen cannot
 * branch on `correction_window_closed` as distinct from `follow_up_cycle`
 * without matching on prose, which would break the first time a sentence is
 * reworded. The honest consequence: every refusal shows the server's own
 * sentence, which is always exact, and a screen that needs to act differently
 * decides from its own context rather than by guessing at the rule. This is
 * recorded as a backend gap, not worked around.
 */
export type { SyncOutcome };

/** The outcomes this web client can actually reach. */
export type WebOutcome = Exclude<SyncOutcome, 'waiting_for_parent' | 'not_yet'>;

export interface Recovery {
  outcome: WebOutcome;
  /** A few words. Never alarming, never technical. */
  title: string;
  /** One sentence the officer can act on. */
  explanation: string;
  /** What the screen should offer. `none` means there is nothing useful to do here. */
  action: 'retry' | 'signin' | 'refresh' | 'back' | 'none';
}

/** The shape every client error class in this repository shares. */
interface ApiLike {
  status?: number;
  code?: string;
  message?: string;
}

const RETRY_LATER: Recovery = {
  outcome: 'retry_later',
  title: 'Could not reach the server',
  // Neutral: not "offline mode", not "your data is lost". Nothing was saved
  // and nothing was destroyed; the form is still on screen.
  explanation: 'Nothing was saved. Try again when you have a connection.',
  action: 'retry',
};

/**
 * Classify a thrown failure into what the officer should do.
 *
 * Deliberately conservative: an unrecognised failure becomes "try again"
 * rather than being forced into a label the response does not support.
 */
export function classify(failure: unknown): Recovery {
  const error = failure as ApiLike | null | undefined;
  const status = typeof error?.status === 'number' ? error.status : undefined;
  const code = typeof error?.code === 'string' ? error.code : undefined;

  // A fetch that never reached a server throws a TypeError with no status.
  if (status === undefined) return RETRY_LATER;

  /*
   * B6.5, AND THE ONE THE SPECIFICATION IS EMPHATIC ABOUT.
   *
   * 503 auth_unavailable means the sign-in service could not be CONSULTED --
   * nothing is known about the session, and it may well be perfectly good.
   * Sending the officer to sign in would make them re-enter credentials that
   * were never wrong, in a field, probably on the connection that just failed.
   * So this is a retry, and the page they are on stays exactly as it is.
   */
  if (status === 503 || code === ERROR_CODES.authUnavailable) {
    return {
      outcome: 'retry_later',
      title: 'Could not check your sign-in',
      explanation: 'This is not a problem with your account. Try again in a moment.',
      action: 'retry',
    };
  }

  // 401 is the service ANSWERING that the token is not a session.
  if (status === 401 || code === ERROR_CODES.unauthenticated) {
    return {
      outcome: 'sign_in_again',
      title: 'Your session has ended',
      explanation: 'Sign in again to carry on.',
      action: 'signin',
    };
  }

  /*
   * 404 IS DELIBERATELY AMBIGUOUS AND MUST STAY THAT WAY. It means the record
   * does not exist, OR it is not this officer's, OR it has left their
   * caseload -- and the officer must not be able to tell which. Naming the
   * officer who does hold it, or saying "this exists but is not yours", would
   * turn a list they cannot read into one they can probe.
   */
  if (status === 404 || code === ERROR_CODES.notFound) {
    return {
      outcome: 'left_caseload',
      title: 'This record is not available to you',
      explanation:
        'Either there is no such record, or it is not on your caseload. Both look the same from here, and that is deliberate.',
      action: 'back',
    };
  }

  /*
   * 403 IS NOT AUTOMATICALLY "REFUSED". A refusal is a workflow decision about
   * a record; a 403 here is an authorisation boundary -- an action this role
   * does not have. Labelling it "refused" would invite an officer to change
   * the record and try again, which cannot help.
   */
  if (status === 403 || code === ERROR_CODES.forbidden) {
    return {
      outcome: 'refused',
      title: 'Not something you can do',
      explanation: 'This action belongs to a supervisor or an administrator.',
      action: 'back',
    };
  }

  if (status === 409 || code === ERROR_CODES.conflict) {
    return {
      outcome: 'conflict',
      title: 'This record changed',
      // The server's own sentence is exact about WHICH conflict; keep it.
      explanation: error?.message ?? 'Refresh before trying again.',
      action: 'refresh',
    };
  }

  /*
   * 422 is a business rule refusing, and the rule named itself in the message.
   * Showing that sentence verbatim is both the most precise thing available
   * and the only thing that cannot go stale: no prose is matched, so no
   * rewording breaks this.
   */
  if (status === 422 || code === ERROR_CODES.unprocessable) {
    return {
      outcome: 'refused',
      title: 'That could not be saved',
      explanation: error?.message ?? 'Open the record to see what to change.',
      action: 'none',
    };
  }

  // 400 is the shape of the request, and belongs beside the fields, not here.
  if (status === 400) {
    return {
      outcome: 'refused',
      title: 'Check what was entered',
      explanation: error?.message ?? 'Some of the information was not accepted.',
      action: 'none',
    };
  }

  // 500 and anything unrecognised. The server's fixed sentence carries no
  // detail by design (CONVENTIONS §5.4), so this says what to do instead.
  return RETRY_LATER;
}

/** True when the officer should be offered a sign-in, and only then. */
export const needsSignIn = (failure: unknown): boolean =>
  classify(failure).outcome === 'sign_in_again';

/**
 * Should the screen keep what the officer typed?
 *
 * Always, except when they must sign in again -- and even then nothing is
 * cleared by this client. A failed request is not a reason to throw away a
 * visit someone walked to record.
 */
export const keepsFormState = (failure: unknown): boolean =>
  classify(failure).outcome !== 'sign_in_again';

/* ---- Physical actions: the device, not the server ---------------------- */

/**
 * GPS FAILURES ARE NOT ONE FAILURE. Each of these needs a different thing from
 * the officer: turn something on, stand somewhere else, or simply wait and
 * press again. "Something went wrong" tells a person standing in a field
 * nothing they can act on.
 *
 * These are the browser's own `GeolocationPositionError` codes, not ours.
 */
export type FixProblem = 'permission_denied' | 'unavailable' | 'timeout' | 'unsupported';

export interface FixRecovery {
  problem: FixProblem;
  title: string;
  explanation: string;
}

const FIX_RECOVERY: Record<FixProblem, Omit<FixRecovery, 'problem'>> = {
  permission_denied: {
    title: 'Location is switched off',
    explanation:
      'Turn on location for this site in the browser settings, then take the reading again.',
  },
  unavailable: {
    title: 'No position here',
    explanation: 'Move into the open, away from buildings and trees, and try again.',
  },
  timeout: {
    title: 'The position took too long',
    explanation: 'Stand still for a moment with a clear view of the sky, then try again.',
  },
  unsupported: {
    title: 'This device cannot give a position',
    explanation: 'A boundary records where it was walked, so it cannot be captured here.',
  },
};

/** Maps a browser geolocation error onto the advice the officer needs. */
export function classifyFix(error: { code?: number } | null | undefined): FixRecovery {
  // 1 PERMISSION_DENIED, 2 POSITION_UNAVAILABLE, 3 TIMEOUT.
  const problem: FixProblem =
    error?.code === 1
      ? 'permission_denied'
      : error?.code === 2
        ? 'unavailable'
        : error?.code === 3
          ? 'timeout'
          : 'unavailable';
  return { problem, ...FIX_RECOVERY[problem] };
}

export const unsupportedFix = (): FixRecovery => ({
  problem: 'unsupported',
  ...FIX_RECOVERY.unsupported,
});

/**
 * The outcomes this application can never produce, and why they are absent
 * rather than mapped to something.
 *
 * `waiting_for_parent` is the DEVICE'S OWN hold: C-9.15 says the server never
 * sends it, and it only means anything when records are queued locally and a
 * child is waiting for its parent to be acknowledged. There is no queue here,
 * so nothing ever waits.
 *
 * `not_yet` is the attachment-confirm retry, carried on a 409 with a
 * Retry-After. The web upload confirms in the same breath as it uploads, so
 * there is no interval in which a record is waiting to be checked again.
 *
 * Both belong to the Android application and are left for it.
 */
export const OUTCOMES_NOT_REACHABLE_ON_WEB = ['waiting_for_parent', 'not_yet'] as const;

/** Every outcome is either reachable here or listed above, with nothing left over. */
export const ALL_OUTCOMES_ACCOUNTED_FOR = SYNC_OUTCOMES.every(
  (outcome) =>
    (OUTCOMES_NOT_REACHABLE_ON_WEB as readonly string[]).includes(outcome) ||
    ['retry_later', 'sign_in_again', 'refused', 'left_caseload', 'conflict'].includes(outcome),
);
