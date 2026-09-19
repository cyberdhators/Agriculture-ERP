import { USER_ROLES, type UserRole } from '@agri-erp/shared';

/**
 * THE ACCOUNT LIFECYCLE RULES THE SCREEN MUST NOT GET WRONG.
 *
 * Every rule here also exists on the server, and the server is the authority.
 * These exist so the interface does not OFFER an action the server will refuse:
 * an administrator who clicks "Remove" on their own account and is told no has
 * been misled by the screen, even though nothing bad happened.
 *
 * WHAT IS DELIBERATELY NOT HERE. Any count of administrators. The users list
 * pages by cursor and reports no total, so a client cannot know whether the
 * account in front of it is the last administrator — page one might hold one
 * admin while page three holds another. The last-admin rule is therefore
 * enforced ONLY by the server, under a row lock, and this file's job is to
 * carry its refusal back to the reader intact rather than to guess at it.
 */

export const ROLE_LABELS: Record<UserRole, string> = {
  admin: 'Administrator',
  supervisor: 'Supervisor',
  read_only: 'Read-only',
};

/** The roles a staff account may hold. An extension officer is not one of them. */
export const STAFF_ROLES: readonly UserRole[] = USER_ROLES;

export const ROLE_SCOPE_HELP: Record<UserRole, string> = {
  admin: 'Administrator accounts have national scope and are not tied to a state.',
  supervisor: 'Supervisor accounts operate within one state.',
  read_only: 'Read-only accounts can read within one state and cannot modify records.',
};

/**
 * Whether a role carries a state.
 *
 * The database refuses a supervisor or read-only row without a state and an
 * administrator row with one, and `createUserSchema` refuses the same pairs as
 * field errors. The form follows that model rather than inventing a second one.
 */
export const roleNeedsState = (role: UserRole): boolean => role !== 'admin';

/** How a scope reads in a sentence, for the change summary before a save. */
export function scopeLabel(role: UserRole, stateName: string | null | undefined): string {
  if (role === 'admin') return 'National · all states';
  return stateName && stateName.length > 0 ? stateName : 'State required';
}

/* ---- What may be offered against a given account ---------------------- */

export interface AccountActionContext {
  /** The signed-in principal's application row id, from GET /api/me. */
  readonly viewerId: string | null;
  /** The account the actions belong to. */
  readonly targetId: string;
}

/**
 * C-3: an administrator cannot remove their own account.
 *
 * The server refuses it with `cannot_remove_own_account`, and the screen must
 * not offer it in the first place. Note the null case: when the viewer is not
 * known yet, the action is NOT offered. Failing closed on an unknown viewer is
 * the right direction — the worst outcome of hiding it wrongly is one refresh.
 */
export function canRemoveAccount({ viewerId, targetId }: AccountActionContext): boolean {
  if (!viewerId) return false;
  return viewerId !== targetId;
}

/**
 * An administrator cannot set their own password through the administrative
 * action. It is an action taken ON another person's account; the same person
 * changing their own credential is a different flow, and no route offers it.
 */
export function canSetPasswordFor({ viewerId, targetId }: AccountActionContext): boolean {
  if (!viewerId) return false;
  return viewerId !== targetId;
}

/** Why an action is absent, said in a sentence rather than left blank. */
export const SELF_ACTION_NOTE = 'You cannot remove or set the password on your own account.';

/* ---- Describing a change before it is made ---------------------------- */

export interface RoleChange {
  readonly roleChanged: boolean;
  readonly scopeChanged: boolean;
  readonly from: { role: string; scope: string };
  readonly to: { role: string; scope: string };
}

/**
 * The before-and-after an administrator is shown before a role change.
 *
 * A role change can silently move an account's reach across the whole country —
 * promoting a supervisor to administrator widens them from one state to ten —
 * so the consequence is spelled out in two columns rather than implied by a
 * dropdown that has already changed.
 */
export function describeRoleChange(
  current: { role: UserRole; stateName: string | null },
  next: { role: UserRole; stateName: string | null },
): RoleChange {
  const from = {
    role: ROLE_LABELS[current.role],
    scope: scopeLabel(current.role, current.stateName),
  };
  const to = { role: ROLE_LABELS[next.role], scope: scopeLabel(next.role, next.stateName) };
  return {
    roleChanged: current.role !== next.role,
    scopeChanged: from.scope !== to.scope,
    from,
    to,
  };
}

/* ---- Officer deactivation -------------------------------------------- */

/**
 * The sentence shown AFTER the server has deactivated an officer.
 *
 * `unassignedFarmers` comes back from the route that did the deactivating
 * (C-8R.3). It is never computed here: no route reports an officer's caseload,
 * and counting from a paginated farmer list would be wrong in a way nobody
 * would notice. When the server did not send a number, the outcome says so
 * rather than printing a zero — "0 farmers are now without an officer" is a
 * reassuring sentence to write when the truth is that nobody counted.
 */
export function deactivationOutcome(name: string, unassignedFarmers: number | undefined): string {
  if (unassignedFarmers === undefined) {
    return `${name} deactivated. The number of farmers left without a working officer was not reported.`;
  }
  if (unassignedFarmers === 0) {
    return `${name} deactivated. No farmers were assigned to them.`;
  }
  const plural = unassignedFarmers === 1 ? 'farmer is' : 'farmers are';
  return `${name} deactivated. ${unassignedFarmers.toLocaleString('en')} ${plural} now without a working officer.`;
}

/**
 * The warning shown BEFORE deactivation.
 *
 * There is no preflight count anywhere in the API — the number exists only in
 * the response to the deactivation itself — so this warns without a figure
 * rather than inventing one to make the dialog feel more informative.
 */
export const DEACTIVATION_WARNING =
  'Farmers currently assigned to this officer may become orphaned. The number affected is reported once the change is made.';
