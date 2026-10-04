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
 * ============================================================================
 * PROVISIONAL. Eight runs across three days: 21 September, 1 and 2 October.
 * ============================================================================
 *
 * WIDENED FROM 45-100 ON 2026-10-04, AND THE REASON IS A NEW OBSERVATION RATHER
 * THAN A FAILING RUN. The 45 was derived when the fastest run on record was 53.6
 * minutes. On 2 October a full-suite run came in at **52.4 minutes** -- a new
 * fastest, which moved the FLOOR, where every previous sample had only moved the
 * ceiling. It passed with 7.4 minutes of margin. A slightly faster run would have
 * produced a FALSE FINDING on a perfectly good suite, and a gate that cries wolf
 * once teaches people to disbelieve it afterwards.
 *
 * THERE IS NO DRIFT, and the earlier version of this comment claimed one. Three
 * runs taken in a single morning were read as a 37.8% trend over ten days; a
 * 53.4-minute run on the same branch and the same content followed hours later.
 * The suite does not have a level. It has a spread.
 *
 * OBSERVED RANGE: 52.4 to 85.2 MINUTES -- about 63% wide, on near-identical
 * content.
 *
 *   date        duration   run
 *   2026-09-21   61.6 min   35551165343
 *   2026-09-21   53.5 min   35551340622
 *   2026-10-01   85.2 min   36837814704
 *   2026-10-01   84.6 min   36847625786
 *   2026-10-01   84.9 min   36865645947
 *   2026-10-01   73.9 min   36879685459
 *   2026-10-01   53.4 min   36875283354
 *   2026-10-02   52.4 min   36954347577
 *
 * DERIVATION, so the next person argues with the reasoning rather than the number:
 *
 *   - LOWER 40, about 24% below the fastest run observed. A suite that finishes
 *     far faster than its range has usually stopped running something, and absence
 *     is not success.
 *   - UPPER 105, about 23% above the slowest run observed, and **15 minutes under
 *     the 120-minute timeout** so the gate still fires before the cliff. That
 *     ordering is the whole design.
 *   - The margin either side is about 25%, and that figure is TAKEN FROM THE
 *     SPREAD the 85-to-52 pair revealed, not assumed. A band fitted tightly to
 *     eight samples fires on the ninth.
 *
 * ----------------------------------------------------------------------------
 * A STOPGAP. The lower bound is the wrong instrument and is already scheduled to
 * go: **issue #112 replaces it with a committed expected test count** (due
 * 2026-10-16). The lower bound exists to catch a suite that did less work, and
 * elapsed time is a poor proxy for that -- every new sample has widened the
 * interval rather than confirming it. A count measures the thing directly. The
 * UPPER bound stays: it guards against a runaway, which duration is the right
 * instrument for.
 * ----------------------------------------------------------------------------
 *
 * WHAT "DO NOT WIDEN" DOES AND DOES NOT FORBID. It forbids enlarging the band to
 * silence a failing run. It does NOT forbid the deliberate re-derivation a
 * PROVISIONAL band is waiting for -- which is what this change is. The difference
 * is the evidence, not the direction: widening because a run went red is
 * silencing; re-deriving because a new observation moved the range is the band
 * doing its job. **No run was red when this was widened.**
 */
export const EXPECTED_BAND_MINUTES = Object.freeze({ min: 40, max: 105 });

/** Eight runs, three days. Not a distribution. Superseded by #112's test count. */
export const BAND_IS_PROVISIONAL = true;

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
