import { describe, expect, it } from 'vitest';

import {
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

  it('admits every duration actually observed', () => {
    // Job time, queue excluded, read from the Actions API on 2026-10-01.
    for (const minutes of [53.6, 61.6, 84.6, 84.9, 85.2]) {
      expect(
        durationComplaint(minutes * 60),
        `${minutes} min was observed and must pass`,
      ).toBeNull();
    }
  });

  it('catches a repeat of the drift already seen', () => {
    // 37.8% on top of 85 minutes is about 117 — outside the band, inside the
    // timeout. So the next drift of that size is a finding, not an outage.
    const drifted = 85 * 1.378;
    expect(drifted).toBeLessThan(TIMEOUT_MINUTES);
    expect(durationComplaint(drifted * 60)).not.toBeNull();
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

  it('leaves ordinary variance alone', () => {
    // The slowest observed run plus 15% is still inside. A gate that fires on
    // normal runner variance is a gate that gets ignored.
    expect(durationComplaint(85.2 * 1.15 * 60)).toBeNull();
  });
});
