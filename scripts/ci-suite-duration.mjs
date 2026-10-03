/**
 * ============================================================================
 * ONE OWNER FOR THE SUITE'S EXPECTED DURATION.
 * ============================================================================
 *
 * Before this file, four numbers claimed to be the suite's duration and none of
 * them agreed:
 *
 *   - `ci.yml`: "44m46s on #54's green run"  -- a single historical measurement
 *     presented as a figure.
 *   - `ci.yml`: "the database suite is 10-20 minutes from a runner" -- wrong by a
 *     factor of four, and sitting directly above the timeout that depends on it.
 *   - A session's "52-65 minutes", stated as though citing something. It is
 *     written nowhere in this repository and matched the two 21 September runs by
 *     coincidence.
 *   - The 90-minute `timeout-minutes`, which was the only one with teeth and had
 *     no stated derivation at all.
 *
 * This module is the single place. The timeout and the duration gate both read it,
 * and no comment anywhere asserts a figure of its own -- the same remedy applied
 * to the production-project fact and to the staging project reference.
 *
 * ----------------------------------------------------------------------------
 * OBSERVED HISTORY. Job time, queue excluded.
 * ----------------------------------------------------------------------------
 *
 * Every figure here was read from the GitHub Actions jobs API, not from a record:
 *
 *   2026-09-21  53.6 min  #101   success   run 35551340622
 *   2026-09-21  61.6 min  main   success   run 35551165343
 *   2026-10-01  85.2 min  #103   (failed at the secret scan, after the suite)
 *   2026-10-01  84.6 min  #108   (failed at the secret scan, after the suite)
 *   2026-10-01  84.9 min  #109   success   run 36865645947
 *
 * A 37.8% increase in ten days, on near-identical test content: #103, #108 and
 * #109 are all main plus a handful of commits, and main has not moved since the
 * 61.6-minute run.
 *
 * WHY IT GREW IS NOT KNOWN AND IS NOT GUESSED HERE. The obvious candidate --
 * staging accumulating rows the suite never sweeps -- is REFUTED by measurement:
 * `audit_event` held about 62,705 rows at the 61.6-minute run and 65,609 on
 * 1 October, a 4.6% increase against a 37.8% slowdown. 53 MB and 65,000 rows do
 * not cost twenty-three minutes. Candidates not tested: runner variance, the
 * staging instance's own performance, network latency to the pooler. The cause is
 * UNESTABLISHED, and this file does not pretend otherwise.
 */

/**
 * The band the suite is expected to fall in, in minutes.
 *
 * DERIVATION, so the next person can disagree with the reasoning rather than the
 * number:
 *
 *   - The lower bound, 45, sits below the fastest run ever observed (53.6) with
 *     room to spare. A suite that suddenly finishes far faster has probably
 *     stopped running something, which is worth a red run -- absence is not
 *     success.
 *   - The upper bound, 100, sits ABOVE the slowest observed run (85.2) by about
 *     17%, which is ordinary variance on a shared runner, and BELOW the timeout
 *     of 120. That ordering is the whole point: drift hits this gate, which says
 *     what happened, before it hits the timeout, which just kills the job.
 *   - A repeat of the drift already seen -- 37.8% on top of 85 minutes, about 117
 *     -- lands outside the band and inside the timeout. So the next drift of that
 *     size is a FINDING, not an outage.
 *
 * THIS BAND IS A CLAIM ABOUT THE SUITE AS OF 2026-10-01 AND IT WILL GO STALE.
 * Revise it deliberately, with a new observed history above and a new derivation
 * here. **Never widen it to make a failing run pass** -- that converts the one
 * instrument watching for drift into a record of the drift it stopped catching.
 */
export const EXPECTED_BAND_MINUTES = Object.freeze({ min: 45, max: 100 });

/**
 * The job timeout, in minutes. Read by `ci.yml`'s comment, which no longer states
 * a number of its own.
 *
 * Raised from 90 on 2026-10-01. At 90 the margin above an observed 84.9-minute run
 * was 5.1 minutes -- six percent -- and nothing had noticed the suite drifting
 * into it. 120 gives roughly 41% headroom over the current level. It is a
 * backstop against a hung job, not a target: the duration gate above is what is
 * supposed to fire first.
 */
export const TIMEOUT_MINUTES = 120;

/** Outside the band, with the sentence to print. `null` when inside. */
export function durationComplaint(elapsedSeconds) {
  const minutes = elapsedSeconds / 60;
  const { min, max } = EXPECTED_BAND_MINUTES;

  if (minutes > max) {
    return (
      `The suite took ${minutes.toFixed(1)} minutes, above the expected band of ` +
      `${min}-${max}. Nothing is wrong with this run's results -- every test that ran, ` +
      `passed or failed on its merits. What is wrong is the trend: the suite drifted ` +
      `37.8% in ten days once already, unnoticed, until the margin to the ` +
      `${TIMEOUT_MINUTES}-minute timeout was six percent. This gate exists so the next ` +
      `drift is a finding instead of an outage.\n\n` +
      `DO NOT WIDEN THE BAND TO MAKE THIS PASS. Find out what changed, then revise ` +
      `the band deliberately in scripts/ci-suite-duration.mjs with a new observed ` +
      `history and a new derivation.`
    );
  }

  if (minutes < min) {
    return (
      `The suite took ${minutes.toFixed(1)} minutes, below the expected band of ` +
      `${min}-${max}. A suite that finishes far faster than it used to has usually ` +
      `stopped running something, and absence is not success. Check that the full ` +
      `suite ran and not the pure one.`
    );
  }

  return null;
}
