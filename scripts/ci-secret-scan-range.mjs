/**
 * WHICH COMMITS THE BLOCKING SECRET SCAN READS -- OR A REFUSAL NAMING WHY NOT.
 *
 * The blocking scan judges a branch on what the branch adds. It does not read
 * inherited history, because a scan over all history cannot be made green once
 * anything has ever leaked, and a gate that can never be green is bypassed. Full
 * history moved to `.github/workflows/secret-audit.yml`, on a schedule.
 *
 * ================================================================
 * THIS FILE EXISTS BECAUSE OF A FAULT FOUND IN DESIGN REVIEW.
 * ================================================================
 *
 * The obvious range is `origin/main..HEAD`. On a `push` to `main` that range is
 * EMPTY -- so the scan would have read nothing at exactly the moment a branch's
 * commits enter main, and zero findings reads as clean. That is the empty-set
 * class recorded in CLAUDE.md: `prisma migrate status` reporting a healthy
 * database with a mismatched checksum, and the checksum gate resolving its own
 * migrations directory relative to the caller's working directory so every file
 * read as absent and every comparison was skipped.
 *
 * So this module has one job and refuses rather than guesses:
 *
 *   A GATE THAT CANNOT DETERMINE WHAT TO COMPARE MUST FAIL, NOT REPORT CLEAN.
 *
 * Every unresolvable input throws, and the message NAMES THE INPUT it could not
 * resolve -- not "could not determine range", which only tells you to go looking.
 */

/** A git sha of all zeros: what a push event carries when there is no before. */
const ABSENT_SHA = /^0{7,40}$/;

export class UnresolvableRange extends Error {
  constructor(message) {
    super(message);
    this.name = 'UnresolvableRange';
  }
}

/**
 * The `--log-opts` range for the blocking scan.
 *
 * ABSENT IS NOT EMPTY AND NOT ZERO. A missing base ref and a base ref of ""
 * are both "we were not told", and neither becomes "scan nothing".
 *
 * @param event  `pull_request` or `push`
 * @param baseRef  the PR's base branch name, e.g. `main`
 * @param beforeSha  the push event's `before` sha
 */
export function rangeFor({ event, baseRef, beforeSha }) {
  if (event === 'pull_request') {
    if (typeof baseRef !== 'string' || baseRef.trim() === '') {
      throw new UnresolvableRange(
        'Cannot determine which commits to scan: the pull request event carried no ' +
          'base ref (github.base_ref was absent or empty). Refusing to scan an ' +
          'undetermined range -- nothing was scanned, and this is NOT a clean result.',
      );
    }
    return `origin/${baseRef.trim()}..HEAD`;
  }

  if (event === 'push') {
    if (typeof beforeSha !== 'string' || beforeSha.trim() === '') {
      throw new UnresolvableRange(
        'Cannot determine which commits to scan: the push event carried no before ' +
          'sha (github.event.before was absent or empty). Refusing to scan an ' +
          'undetermined range -- nothing was scanned, and this is NOT a clean result.',
      );
    }
    if (ABSENT_SHA.test(beforeSha.trim())) {
      throw new UnresolvableRange(
        `Cannot determine which commits to scan: the push event's before sha is all ` +
          `zeros (${beforeSha.trim()}), which means this ref had no previous tip -- a ` +
          `branch created by this push. There is no range to compare. Run the ` +
          `full-history audit workflow against this ref instead. Refusing to scan an ` +
          `undetermined range -- nothing was scanned, and this is NOT a clean result.`,
      );
    }
    return `${beforeSha.trim()}..HEAD`;
  }

  throw new UnresolvableRange(
    `Cannot determine which commits to scan: unrecognised event name ` +
      `${JSON.stringify(event)}. The blocking scan knows 'pull_request' and 'push'. ` +
      `Refusing to scan an undetermined range -- nothing was scanned, and this is ` +
      `NOT a clean result.`,
  );
}
