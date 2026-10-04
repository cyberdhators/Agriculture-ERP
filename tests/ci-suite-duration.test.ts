import { describe, expect, it } from 'vitest';

import {
  BAND_IS_PROVISIONAL,
  EXPECTED_BAND_MINUTES,
  TIMEOUT_MINUTES,
  durationComplaint,
} from '../scripts/ci-suite-duration.mjs';

/**
 * THE DURATION GATE FIRES BEFORE THE TIMEOUT.
 *
 * That ordering is the whole design, so it is asserted rather than documented: a
 * band whose upper bound sat above the timeout would never fire, because the job
 * would be killed first and the gate would never run. It would be a gate that
 * cannot speak.
 */
describe('the suite duration band', () => {
  it('has its upper bound BELOW the timeout — otherwise the gate can never fire', () => {
    expect(EXPECTED_BAND_MINUTES.max).toBeLessThan(TIMEOUT_MINUTES);
  });

  it('is PROVISIONAL and says so — eight runs on three days is not a distribution', () => {
    expect(BAND_IS_PROVISIONAL).toBe(true);
  });

  it('admits every duration actually observed — all eight, across the full range', () => {
    // Job time, queue excluded, read from the Actions API. 52.4 and 85.2 are the
    // two ends; the 52.4 moved the FLOOR, which is why the band was widened.
    for (const minutes of [52.4, 53.4, 53.5, 61.6, 73.9, 84.6, 84.9, 85.2]) {
      expect(
        durationComplaint(minutes * 60),
        `${minutes} min was observed and must pass`,
      ).toBeNull();
    }
  });

  it('still catches something outside the observed range but inside the timeout', () => {
    // A run can be a finding without being an outage. That ordering is the design.
    const beyond = 112;
    expect(beyond).toBeLessThan(TIMEOUT_MINUTES);
    expect(beyond).toBeGreaterThan(EXPECTED_BAND_MINUTES.max);
    expect(durationComplaint(beyond * 60)).not.toBeNull();
  });

  it('gives the fastest observed run real margin — the old bound did not', () => {
    // At 45 the 52.4-minute run passed by 7.4 minutes. A slightly faster run
    // would have been a false finding, and a gate that cries wolf once is
    // disbelieved afterwards.
    expect(52.4 - EXPECTED_BAND_MINUTES.min).toBeGreaterThan(10);
  });

  it('catches a suite that suddenly runs far faster — absence is not success', () => {
    expect(durationComplaint(30 * 60)).not.toBeNull();
    expect(durationComplaint(30 * 60)).toContain('stopped running something');
  });

  it('refuses to widen itself: the complaint says so in words', () => {
    const complaint = durationComplaint(118 * 60);
    expect(complaint).toContain('DO NOT WIDEN THE BAND');
    // And it says the run's own results are not in question, so nobody reads a
    // duration complaint as a test failure.
    expect(complaint).toContain('passed or failed on its merits');
  });

  it('leaves the observed spread alone — it is about 63% wide', () => {
    const spread = (85.2 - 52.4) / 52.4;
    expect(spread).toBeGreaterThan(0.6);
    expect(durationComplaint(52.4 * 60)).toBeNull();
    expect(durationComplaint(85.2 * 60)).toBeNull();
  });
});
