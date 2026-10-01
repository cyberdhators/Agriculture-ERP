/**
 * THE CLOSED ALLOWLIST OF PROJECTS A DESTRUCTIVE SCRIPT MAY TOUCH.
 *
 * Every guard that resets a database, creates or deletes authentication
 * accounts, or writes fixture rows consults this list and nothing else. A
 * reference in it is a project known not to hold real farmer data. A reference
 * absent from it is refused — including, and especially, one nobody has
 * classified yet.
 *
 * WHY A LIST AND NOT A COMPARISON. Three guards each carried their own
 * `STAGING_PROJECT_REF` literal and compared against it. The behaviour was
 * correct and the shape was not: three copies drift, and the question each was
 * really asking — "is this a database I may destroy?" — cannot be answered by
 * equality with one name. It is answered by membership of a list of projects
 * somebody has looked at and classified. Today that list has one member, and
 * that is the whole point: two known-non-production literals exclude production
 * exactly as well as one does.
 *
 * COMMITTED LITERALS ONLY. This list is never read from an environment
 * variable, a config file, a CLI flag, an argument, or any other runtime input.
 * A guard that takes its allowlist from the environment hands control of itself
 * to whoever sets the environment, and that is the route production comes in by.
 * The import is static and the array is frozen so a caller cannot extend it at
 * run time either. If a future change appears to need a runtime value here,
 * that is the signal to stop and ask, not to add a parameter.
 *
 * NOT IN THIS LIST, DELIBERATELY: any production project. No production project
 * exists at the time of writing — `docs/DECISIONS.md` records that the account
 * held exactly one project when the Management API was last read — and no
 * production reference appears anywhere in this repository. Adding one here
 * would be adding the only copy of a name whose entire purpose is to be
 * excluded, so it is not added. The guard excludes it by refusing everything
 * absent from the list, which needs no knowledge of what production is called.
 */

/** Projects known not to hold real farmer data. Frozen; committed literals only. */
export const NON_PRODUCTION_PROJECT_REFS = Object.freeze([
  // `agri-staging`. Named in docs/PROJECT-STATE.md, holds invented rows only.
  'xmmxbrxmfgodhpwolrvk',
]);

/**
 * True when every connection string given names a project on the allowlist.
 *
 * Takes the strings rather than reading `process.env` itself, so a caller cannot
 * be surprised about which variables were checked, and so this can be tested
 * without an environment.
 */
export function allNamesAllowed(connectionStrings) {
  return connectionStrings.every((value) =>
    NON_PRODUCTION_PROJECT_REFS.some((ref) => String(value ?? '').includes(ref)),
  );
}

/** The ones that name no allowlisted project. Never the strings themselves. */
export function namesNotAllowed(named) {
  return Object.entries(named)
    .filter(
      ([, value]) => !NON_PRODUCTION_PROJECT_REFS.some((ref) => String(value ?? '').includes(ref)),
    )
    .map(([name]) => name);
}
