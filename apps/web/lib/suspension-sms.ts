/**
 * THE TEXT A SUSPENSION SENDS (2026-10-26, CORWADO's acceptance test). No
 * imports, so a pure test can read it; sent by lib/api/moderation.ts.
 */

/** The address the message names. The Contact CORWADO form is on the help page. */
export const APPEAL_ADDRESS = 'agrionesouthsudan.com/help';

/** Longest reason label that keeps the message inside one 160-character SMS. */
const LABEL_MAX = 39;

/**
 * The fixed text. It carries the reason CODE's label (one of CORWADO's list,
 * written by staff for this purpose), never the free-text reason, which may
 * name other people or hold notes meant for the file. With no code chosen, no
 * reason is named.
 */
export function suspensionSmsText(label: string | null): string {
  const named =
    label === null
      ? ''
      : ` Reason: ${label.length > LABEL_MAX ? `${label.slice(0, LABEL_MAX - 3)}...` : label}.`;
  return (
    `AgriOne: your account is suspended.${named} To appeal, visit ${APPEAL_ADDRESS} ` +
    `and choose 'Appeal a decision'.`
  );
}

/**
 * 2026-10-28: the text a DISABLE sends -- the same shape, saying "disabled".
 * At most 160 characters with the longest label (tests/notify-scan.test.ts).
 */
export function disabledSmsText(label: string | null): string {
  const named =
    label === null
      ? ''
      : ` Reason: ${label.length > LABEL_MAX ? `${label.slice(0, LABEL_MAX - 3)}...` : label}.`;
  return (
    `AgriOne: your account is disabled.${named} To appeal, visit ${APPEAL_ADDRESS} ` +
    `and choose 'Appeal a decision'.`
  );
}
