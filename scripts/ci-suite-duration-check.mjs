/**
 * Fails the job when the suite's elapsed time falls outside the expected band.
 *
 * IT FAILS, IT DOES NOT WARN. A warning nobody reads is the entire content of
 * 2026-10-01's evidence: every run printed its own duration and nobody compared it to
 * anything, so a 63% spread was invisible -- and was then misread as a 37.8% drift
 * over ten days that had not happened. The band is PROVISIONAL.
 *
 * It runs AFTER the suite, so a failing suite is red on its own merits and never
 * masked by a duration complaint.
 *
 *   node scripts/ci-suite-duration-check.mjs <elapsed-seconds>
 */
import { EXPECTED_BAND_MINUTES, durationComplaint } from './ci-suite-duration.mjs';

const raw = process.argv[2];
const elapsed = Number(raw);

if (!Number.isFinite(elapsed) || elapsed <= 0) {
  console.error(
    `The duration gate was given ${JSON.stringify(raw)} as the elapsed seconds and ` +
      'cannot compare that to anything. A gate that cannot determine what to compare ' +
      'must fail, not report clean.',
  );
  process.exit(2);
}

const complaint = durationComplaint(elapsed);
const { min, max } = EXPECTED_BAND_MINUTES;

if (complaint === null) {
  console.log(
    `Suite duration ${(elapsed / 60).toFixed(1)} minutes — inside the expected band of ${min}-${max}.`,
  );
  process.exit(0);
}

console.error(`\nSUITE DURATION OUTSIDE THE EXPECTED BAND\n\n${complaint}`);
process.exit(1);
