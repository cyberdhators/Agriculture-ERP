/**
 * THE CLOSED ALLOWLIST OF PROJECTS A DESTRUCTIVE SCRIPT MAY TOUCH.
 *
 * Every guard that resets a database, creates or deletes authentication
 * accounts, or writes fixture rows consults this list and nothing else. A
 * reference in it is a project somebody has classified as holding no real
 * farmer data. A reference absent from it is refused — including, and
 * especially, one nobody has classified yet.
 *
 * THE LIST IS EMPTY TODAY, AND THAT IS THE SAFE STATE. An empty allowlist
 * refuses every target: db:reset refuses, the test principals refuse, the
 * database suite refuses to start. That is exactly the behaviour T2 gave the
 * same three guards with unconditional throws (docs/DECISIONS.md, "Staging is
 * production"). This re-points them at the list instead of throwing, so that
 * when a disposable project exists its reference is added here — one deliberate
 * line — and the guards admit it without any of them being edited. Nothing is
 * un-retired: with no reference listed, the guards refuse precisely as before.
 *
 * NOT IN THIS LIST, EVER: a production project. The account holds exactly one
 * Supabase project, `xmmxbrxmfgodhpwolrvk`. It was named `agri-staging` and the
 * three guards once compared against that literal; since 2026-10-06 it IS
 * production (docs/DECISIONS.md, "Staging is production"). It must never appear
 * below. The whole purpose of the list is to be the set of databases that may
 * be destroyed, and that project may not be. A disposable project is a NEW,
 * SEPARATE project created for tests; its reference — not this one — is what a
 * future line adds.
 *
 * COMMITTED LITERALS ONLY. This list is never read from an environment
 * variable, a config file, a CLI flag, an argument, or any other runtime input.
 * A guard that takes its allowlist from the environment hands control of itself
 * to whoever sets the environment, and that is the route production comes in by.
 * The import is static and the array is frozen so a caller cannot extend it at
 * run time either. If a future change appears to need a runtime value here,
 * that is the signal to stop and ask, not to add a parameter.
 */

/**
 * Projects known not to hold real farmer data. Frozen; committed literals only.
 *
 * EMPTY on purpose — see the header. Add the reference of a NEW disposable
 * project here when one exists; never the one production project.
 */
export const NON_PRODUCTION_PROJECT_REFS = Object.freeze([]);

/**
 * Does one connection string name a project on `refs`?
 *
 * `refs` is a parameter for ONE reason: so the matching logic can be proved in
 * both directions — a listed reference admitted, an unlisted one refused — by a
 * test, while the committed list above is still empty and names no real project.
 * Every guard calls the zero-argument wrappers below, which pass the frozen
 * committed list; no guard is ever handed a list at run time. This is not the
 * "runtime value" the header forbids — the policy (which refs) stays committed;
 * only the pure string match is made testable.
 */
export function connectionNamesListedProject(connectionString, refs) {
  return refs.some((ref) => String(connectionString ?? '').includes(ref));
}

/**
 * True when every connection string given names a project on the allowlist.
 *
 * Takes the strings rather than reading `process.env` itself, so a caller cannot
 * be surprised about which variables were checked, and so this can be tested
 * without an environment. With an empty list this is always false.
 */
export function allNamesAllowed(connectionStrings) {
  return connectionStrings.every((value) =>
    connectionNamesListedProject(value, NON_PRODUCTION_PROJECT_REFS),
  );
}

/** The ones that name no allowlisted project. Never the strings themselves. */
export function namesNotAllowed(named) {
  return Object.entries(named)
    .filter(([, value]) => !connectionNamesListedProject(value, NON_PRODUCTION_PROJECT_REFS))
    .map(([name]) => name);
}
