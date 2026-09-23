'use client';

import { useCallback, useMemo, useState } from 'react';

import { Button, Field, Select } from '@/components/ui';
import {
  addPoint,
  boundaryAccuracy,
  canClose,
  distinctCount,
  gradeOf,
  looksSelfCrossing,
  MAX_POINTS,
  mappingProblems,
  previewAreaHa,
  seasonOptions,
  undoLast,
  type Problem,
  type WalkPoint,
} from '@/lib/officer/farm-mapping';
import { classifyFix, unsupportedFix, type FixRecovery } from '@/lib/officer/recovery';

import { WalkTrace } from './WalkTrace';
import styles from './officer-farms.module.css';

/**
 * THE WALK ITSELF, SHARED BY MAPPING AND RE-MAPPING.
 *
 * Both are the same physical act — walk the corners, close the ring — and
 * differ only in where the result is posted. Keeping one copy means the GPS
 * handling, the minimum-corner rule and the accuracy grading cannot drift
 * apart between the two screens.
 *
 * DISCRETE POINTS, NOT A TRACK. One press, one `getCurrentPosition`.
 * `watchPosition` is deliberately not used: the contract stores a ring of
 * corners and ONE accuracy for the boundary, not a breadcrumb trail, so
 * continuous tracking would flatten a field phone's battery to produce data
 * the server has nowhere to keep.
 *
 * NOTHING IS EVER INVENTED. No 0,0, no farmer's payam as a stand-in, no
 * remembered position, no typed coordinates, nothing written to the device. A
 * failed reading is reported and the corner is simply not marked.
 */
export function BoundaryWalk({
  season,
  onSeasonChange,
  seasonHint,
  saveLabel,
  saving,
  failure,
  onSave,
}: {
  season: string;
  onSeasonChange: (season: string) => void;
  seasonHint: string;
  saveLabel: string;
  saving: boolean;
  failure: string | null;
  onSave: (points: readonly WalkPoint[], season: string) => void;
}) {
  const [points, setPoints] = useState<readonly WalkPoint[]>([]);
  const [locating, setLocating] = useState(false);
  const [fixError, setFixError] = useState<FixRecovery | null>(null);
  const [submitted, setSubmitted] = useState(false);

  const markCorner = useCallback(() => {
    setFixError(null);
    if (typeof navigator === 'undefined' || !navigator.geolocation) {
      setFixError(unsupportedFix());
      return;
    }
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      (position) => {
        setPoints((was) =>
          addPoint(was, {
            longitude: position.coords.longitude,
            latitude: position.coords.latitude,
            accuracy_m: position.coords.accuracy,
          }),
        );
        setLocating(false);
      },
      (error) => {
        setLocating(false);
        // Four distinct states, each with a different thing to do. Collapsing
        // them into one apology leaves an officer standing in a field with no
        // idea whether to move, wait, or change a setting.
        setFixError(classifyFix(error));
      },
      { enableHighAccuracy: true, timeout: 20_000, maximumAge: 0 },
    );
  }, []);

  const corners = distinctCount(points);
  const worst = boundaryAccuracy(points);
  const estimate = previewAreaHa(points);
  const crossing = useMemo(() => looksSelfCrossing(points), [points]);
  const problems: Problem[] = useMemo(
    () => mappingProblems(points, season, { farmId: PLACEHOLDER, boundaryId: PLACEHOLDER }),
    [points, season],
  );

  const save = () => {
    setSubmitted(true);
    if (problems.length > 0) return;
    onSave(points, season);
  };

  return (
    <>
      <section className={styles.walk} aria-labelledby="walk-h">
        <h2 id="walk-h" className={styles.blockHead}>
          The boundary
        </h2>

        <WalkTrace points={points} />

        <dl className={styles.figures}>
          <div>
            <dt>Corners</dt>
            <dd className="mono">{corners}</dd>
          </div>
          <div>
            <dt>GPS accuracy</dt>
            {/*
              ABSENT until something has actually been read. Never zero — zero
              metres would grade "good" and claim a perfect fix nobody took.
            */}
            <dd className="mono">
              {worst === null ? (
                <span className={styles.none}>not yet read</span>
              ) : (
                <>
                  ±{worst} m{' '}
                  <span className={styles[`grade_${gradeOf(worst)}`]}>{gradeOf(worst)}</span>
                </>
              )}
            </dd>
          </div>
          <div>
            <dt>Area (estimate)</dt>
            <dd className="mono">
              {estimate === null ? (
                <span className={styles.none}>not yet</span>
              ) : (
                `${estimate.toFixed(2)} ha`
              )}
            </dd>
          </div>
        </dl>
        <p className={styles.note}>
          That area is an estimate for checking as you walk. The recorded area is calculated by the
          server when you save.
        </p>

        {worst !== null && gradeOf(worst) === 'unusable' ? (
          <p className={styles.warn}>
            The signal here is too weak for a usable boundary. It will be saved and marked unusable.
          </p>
        ) : null}

        {crossing ? (
          <p className={styles.warn}>
            The path you have walked seems to cross itself. The server checks this properly and will
            refuse a crossed boundary.
          </p>
        ) : null}

        <Button
          className={styles.mark}
          onClick={markCorner}
          disabled={locating || points.length >= MAX_POINTS}
        >
          {locating ? 'Reading the position…' : 'Mark this corner'}
        </Button>
        <Button
          variant="secondary"
          className={styles.wide}
          onClick={() => setPoints(undoLast(points))}
          disabled={points.length === 0 || locating}
        >
          Undo last corner
        </Button>

        {fixError ? (
          <p className={styles.fieldError} role="alert">
            <strong className={styles.problemTitle}>{fixError.title}</strong> {fixError.explanation}
          </p>
        ) : null}
        {canClose(points) ? (
          <p className={styles.ready}>
            Enough corners to close. Finish at the corner you started from if you have not already.
          </p>
        ) : (
          <p className={styles.note}>
            Walk to each corner of the plot and mark it. At least four different corners are needed
            before the boundary can close.
          </p>
        )}
      </section>

      <Field label="Season" hint={seasonHint}>
        {(ids) => (
          <Select {...ids} value={season} onChange={(e) => onSeasonChange(e.target.value)}>
            {seasonOptions().map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </Select>
        )}
      </Field>

      {submitted && problems.length > 0 ? (
        <ul className={styles.errors} role="alert">
          {problems.map((problem) => (
            <li key={problem.field + problem.message}>{problem.message}</li>
          ))}
        </ul>
      ) : null}
      {failure ? (
        <p className={styles.fieldError} role="alert">
          {failure}
        </p>
      ) : null}

      <Button className={styles.wide} onClick={save} disabled={saving}>
        {saving ? 'Saving…' : saveLabel}
      </Button>
    </>
  );
}

/** Only ever handed to the validator; the real ids are minted at submit. */
const PLACEHOLDER = '00000000-0000-4000-8000-000000000000';
