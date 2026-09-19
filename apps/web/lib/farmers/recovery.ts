/**
 * WHAT A MERGE COSTS, IN THE WORDS THE DIALOG SHOULD USE.
 *
 * This module is three sentences, and that is the whole of Prompt 9's new
 * material. Everything else the recovery brief asks for already exists and
 * already behaves correctly:
 *
 *   - reassignment states the payam rule, names the payam, explains why an
 *     officer elsewhere cannot take the farmer, and says farms and visits
 *     follow while the registering officer stays as history;
 *   - officer deactivation reports the server's own orphan count and says so
 *     when the server reported none;
 *   - verification and rejection carry the six fixed reason codes and the
 *     280-character cap;
 *   - soft removal of a farmer, farm, visit and staff account each state that
 *     history remains and nothing is permanently deleted;
 *   - the dashboard already names the missing national orphan capability in
 *     one place, `UNAVAILABLE_METRICS`.
 *
 * Writing second copies of those here would have been duplication dressed as
 * a redesign. The merge dialog was the one consequential act that did not tell
 * the administrator what it was about to do.
 */

/**
 * `POST /api/farmers/:id/merge` refuses a target in another state
 * (`merge_across_states`) and one already merged or rejected
 * (`merge_target_not_eligible`).
 *
 * THE CLIENT CANNOT PRE-FILTER THIS. No route looks a farmer up by number, so
 * the survivor is typed in as an identifier and the server is the first thing
 * able to judge it. Stating the rule before the act, and showing the server's
 * own refusal if it is broken, is the honest arrangement when the screen
 * cannot check in advance.
 */
export const MERGE_CONSTRAINT =
  'Both records must be in the same state. A merge across states is refused by the server.';

/**
 * Nothing is deleted, and the criteria decide where the record then counts:
 * C-6.8 reports merged records beside verified reach and never inside it.
 */
export const MERGE_CONSEQUENCE =
  'This record is kept and points to the survivor. It stops counting as a separate farmer and is reported as merged, never folded into verified reach.';

/**
 * Irreversible, and not because anything is destroyed.
 *
 * `VERIFICATION_TRANSITIONS` gives `merged: []` — there is no step out of
 * merged, and no route reverses one. Both rows survive; the decision does not.
 */
export const MERGE_IRREVERSIBLE =
  'A merge cannot be undone: there is no step out of merged, and no route reverses it. Check both records before continuing.';
