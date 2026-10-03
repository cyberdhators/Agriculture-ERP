'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';

import { Button, Field, Input, Select, Textarea } from '@/components/ui';
import { UnavailableState } from '@/components/ui/data';
import {
  correctVisit,
  getVisit,
  getVisitChain,
  isRemovedLink,
  listFarmerVisits,
  LIVE_VISITS,
  type ChainLink,
  type Visit,
} from '@/lib/visits/api';
import { VISIT_TOPIC_LABELS } from '@/lib/visits/fixtures';
import { getFarmer, LIVE_FARMERS } from '@/lib/farmers/api';
import type { Farmer } from '@/lib/fixtures/farmers';
import { usePreview } from '@/lib/preview';
import {
  buildCorrection,
  correctionDraftFrom,
  correctionProblems,
  correctionState,
  followUpOptions,
  isEmptyCorrection,
  TOPICS,
  toggleTopic,
  type CorrectionDraft,
} from '@/lib/officer/visits';
import { formatDate } from '@/lib/format';
import { classify } from '@/lib/officer/recovery';
import { gradeAccuracy } from '@agri-erp/shared';

import { VisitAttachments } from './VisitAttachments';
import styles from './officer-visits.module.css';

/**
 * ONE VISIT, AND THE DAY IN WHICH IT CAN STILL BE CORRECTED.
 *
 * WHAT MAY BE CHANGED IS `correctVisitSchema`'S DECISION. The observation, the
 * advice, the topics, the duration and the attendance -- and nothing else. The
 * farmer, the officer, the position and both moments are not in that schema, so
 * they are refused as unknown fields before any rule runs, and a database
 * trigger (`visit_evidence_immutable`) refuses them again underneath. A
 * correction is not a re-recording of the fieldwork.
 *
 * THE TWENTY-FOUR HOURS ARE THE SERVER'S. It measures them from `received_at`,
 * its OWN moment of receipt, and answers 422 `correction_window_closed` when
 * they have passed. `correctionState` here only decides whether to offer the
 * form; it is a courtesy, not a control. Nothing typed into this browser moves
 * the window, because the window never reads a field the browser can set.
 *
 * NO ADMINISTRATIVE CONTROLS. Removal is the administrator's and soft; this
 * screen does not import it, and the route would answer 403 if it did.
 */
type Phase = 'loading' | 'ready' | 'notfound' | 'error';

/**
 * A deadline, with its hour. `formatDate` gives the day alone, which for a
 * window that shuts twenty-four hours after receipt would read as "any time on
 * the 22nd" when in fact it closes that morning.
 */
function stamp(iso: string): string {
  return new Date(iso).toLocaleString('en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function deadline(iso: string): string {
  return new Date(iso).toLocaleString('en-GB', {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function OfficerVisitDetail({ id }: { id: string }) {
  const { me } = usePreview();
  const myOfficerId = me?.scope?.kind === 'caseload' ? me.scope.officerId : null;
  /**
   * THE FARMER, FETCHED ONE AT A TIME.
   *
   * `GET /api/farmers/:id` runs `loadVisible`, so a farmer outside the
   * caseload is a 404 -- the same officer-safe path every other screen uses.
   * It replaces a 200-row `listFarmers` directory read that existed only to
   * turn one id into one name, and it carries the farmer NUMBER, which that
   * read never returned.
   *
   * It is context, not the record: if it fails the visit still renders.
   */
  const [farmer, setFarmer] = useState<Farmer | null>(null);

  const [visit, setVisit] = useState<Visit | null>(null);
  const [phase, setPhase] = useState<Phase>('loading');
  const [correcting, setCorrecting] = useState(false);
  const [draft, setDraft] = useState<CorrectionDraft | null>(null);
  /**
   * THE CHAIN, from `GET /api/visits/:id/chain`.
   *
   * Two facts, not a timeline: what this visit follows, and what has followed
   * it. The route is scoped by the visit itself and the chain never leaves the
   * farmer, so nothing here can show a visit the officer could not already
   * open. A removed ancestor arrives as an id and `removed: true` and is said
   * to be removed -- never dropped, which would reorder the history, and never
   * filled in, since nothing about it may be read (C-8.11).
   */
  const [earlier, setEarlier] = useState<readonly ChainLink[]>([]);
  const [followUps, setFollowUps] = useState<readonly Visit[]>([]);

  /**
   * Earlier visits for this farmer, for the follow-up control. Fetched only
   * when a correction is begun -- reading the screen does not need them, and
   * the window may well be shut.
   */
  const [eligible, setEligible] = useState<readonly Visit[]>([]);

  const [saving, setSaving] = useState(false);
  const [errors, setErrors] = useState<string[]>([]);

  const load = useCallback(async () => {
    if (!LIVE_VISITS) {
      setPhase('error');
      return;
    }
    setPhase('loading');
    try {
      const row = await getVisit(id);
      setVisit(row);
      setPhase('ready');
    } catch (failure) {
      setPhase((failure as { status?: number })?.status === 404 ? 'notfound' : 'error');
    }
  }, [id]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!LIVE_FARMERS || !visit) return;
    let on = true;
    getFarmer(visit.farmer_id)
      .then((row) => on && setFarmer(row))
      .catch(() => {
        // Named by id below rather than not shown at all.
      });
    return () => {
      on = false;
    };
  }, [visit]);

  useEffect(() => {
    if (!LIVE_VISITS || !visit) return;
    let on = true;
    getVisitChain(visit.id)
      .then((chain) => {
        if (!on) return;
        setEarlier(chain.earlier);
        setFollowUps(chain.follow_ups);
      })
      .catch(() => {
        // The chain is context; the visit itself is already shown.
      });
    return () => {
      on = false;
    };
  }, [visit]);

  useEffect(() => {
    if (!LIVE_VISITS || !correcting || !visit) return;
    let on = true;
    listFarmerVisits(visit.farmer_id, { limit: 20 })
      .then((page) => on && setEligible(page.visits))
      .catch(() => {
        // The current relationship is still represented from the chain below.
      });
    return () => {
      on = false;
    };
  }, [correcting, visit]);

  const window = useMemo(
    () => (visit ? correctionState(visit, myOfficerId) : null),
    [visit, myOfficerId],
  );

  /**
   * The follow-up choices. The current target is always among them, even when
   * it is older than the page fetched or has since been removed -- see
   * `followUpOptions`. Direct follow-ups of this visit are excluded because
   * naming one would be an obvious cycle.
   */
  const options = useMemo(
    () =>
      visit
        ? followUpOptions({
            eligible,
            selfId: visit.id,
            excludeIds: followUps.map((later) => later.id),
            currentId: visit.follow_up_of,
            currentLink: parentOf(earlier),
            label: (v) =>
              `${formatDate(v.visited_at)} · ${v.topics.map((t) => VISIT_TOPIC_LABELS[t] ?? t).join(', ')}`,
          })
        : [],
    [visit, eligible, followUps, earlier],
  );

  if (phase === 'loading') {
    return (
      <div className={styles.page}>
        <div className={styles.skeleton} aria-busy="true" aria-label="Loading the visit" />
      </div>
    );
  }

  if (phase === 'notfound') {
    return (
      <div className={styles.page}>
        <UnavailableState title="This visit is not on your caseload">
          Either there is no such visit, or it belongs to another officer&apos;s farmer. Both look
          the same from here, and that is deliberate.
        </UnavailableState>
      </div>
    );
  }

  if (phase === 'error' || !visit || !window) {
    return (
      <div className={styles.page}>
        <UnavailableState title="This visit could not be loaded">
          {LIVE_VISITS
            ? 'The visit could not be read just now. Nothing has changed.'
            : 'This deployment is running on preview data, so no visit is read.'}
        </UnavailableState>
      </div>
    );
  }

  const save = () => {
    if (!draft) return;
    const patch = buildCorrection(visit, draft);
    if (isEmptyCorrection(patch)) {
      setErrors(['Nothing has been changed yet.']);
      return;
    }
    const problems = correctionProblems(patch);
    if (problems.length > 0) {
      setErrors(problems.map((p) => p.message));
      return;
    }
    setErrors([]);
    setSaving(true);
    correctVisit(visit.id, patch)
      .then((updated) => {
        setVisit(updated);
        setCorrecting(false);
        setDraft(null);
      })
      .catch(async (failure: unknown) => {
        /*
         * THIS USED TO TEST `failure.code === 'correction_window_closed'` AND
         * COULD NEVER FIRE. `unprocessable(rule)` sends the generic code
         * `unprocessable` and puts the rule's own sentence in `message`; the
         * rule KEY never reaches the client (CONVENTIONS §4). So the check was
         * dead and every refusal fell through to a generic line.
         *
         * The fix does not guess from prose. It shows the server's sentence --
         * always exact -- and then asks the SERVER whether the window is still
         * open by re-reading the visit. If it has shut, the form closes,
         * because there is no longer an edit to complete; if the refusal was
         * about something fixable, the form stays and the officer can fix it.
         */
        const recovery = classify(failure);
        setErrors([recovery.explanation]);
        try {
          const fresh = await getVisit(visit.id);
          setVisit(fresh);
          if (!correctionState(fresh, myOfficerId).canCorrect) {
            setCorrecting(false);
            setDraft(null);
          }
        } catch {
          // Could not re-read; leave the form and the sentence as they are.
        }
      })
      .finally(() => setSaving(false));
  };

  return (
    <div className={styles.page}>
      <Link href="/visits" className={styles.back}>
        ← My visits
      </Link>
      <h1 className={styles.title} dir="auto">
        {farmer ? `${farmer.given_name} ${farmer.family_name}` : 'Visit'}
      </h1>
      {/*
        Both moments, wherever a date is shown (C-8.5) -- and with their times,
        because two visits to the same farmer on one day are told apart by the
        hour, not the date.
      */}
      <p className={styles.sub}>
        Visited {stamp(visit.visited_at)} · received {stamp(visit.received_at)}
      </p>
      {farmer ? (
        <Link href={`/farmers/${farmer.id}`} className={styles.chainLink}>
          <span className="mono">{farmer.farmer_number}</span> — open farmer
        </Link>
      ) : null}

      {correcting && draft ? (
        <form
          className={styles.form}
          onSubmit={(event) => {
            event.preventDefault();
            save();
          }}
        >
          <section className={styles.block} aria-labelledby="ctopics-h">
            <h2 id="ctopics-h" className={styles.blockHead}>
              What the visit covered
            </h2>
            <div className={styles.topics} role="group" aria-labelledby="ctopics-h">
              {TOPICS.map((topic) => {
                const on = draft.topics.includes(topic);
                return (
                  <button
                    key={topic}
                    type="button"
                    className={`${styles.topic} ${on ? styles.topicOn : ''}`}
                    aria-pressed={on}
                    onClick={() => setDraft({ ...draft, topics: toggleTopic(draft.topics, topic) })}
                  >
                    {VISIT_TOPIC_LABELS[topic]}
                  </button>
                );
              })}
            </div>
          </section>

          <Field label="Advice you gave">
            {(ids) => (
              <Textarea
                {...ids}
                rows={5}
                value={draft.advice}
                className={styles.advice}
                onChange={(e) => setDraft({ ...draft, advice: e.target.value })}
              />
            )}
          </Field>

          <Field
            label="What you saw (optional)"
            hint="Empty this box to remove it from the record."
          >
            {(ids) => (
              <Textarea
                {...ids}
                rows={3}
                value={draft.observation}
                onChange={(e) => setDraft({ ...draft, observation: e.target.value })}
              />
            )}
          </Field>

          <div className={styles.pair}>
            <Field label="Minutes (optional)">
              {(ids) => (
                <Input
                  {...ids}
                  inputMode="numeric"
                  value={draft.duration_minutes}
                  onChange={(e) => setDraft({ ...draft, duration_minutes: e.target.value })}
                />
              )}
            </Field>
            <Field label="People present (optional)">
              {(ids) => (
                <Input
                  {...ids}
                  inputMode="numeric"
                  value={draft.attendee_count}
                  onChange={(e) => setDraft({ ...draft, attendee_count: e.target.value })}
                />
              )}
            </Field>
          </div>

          {/*
            THE FOLLOW-UP, CORRECTABLE WITHIN THE WINDOW.
            "Not a follow-up" is a real choice and clears the link; leaving the
            selection alone sends no key at all, which is what preserves a
            relationship whose target can no longer be read.
          */}
          <Field
            label="Follow-up to an earlier visit"
            hint="Which visit this one continues, if any."
          >
            {(ids) => (
              <Select
                {...ids}
                value={draft.follow_up_of}
                onChange={(e) => setDraft({ ...draft, follow_up_of: e.target.value })}
              >
                <option value="">Not a follow-up</option>
                {options.map((option) => (
                  <option key={option.id} value={option.id}>
                    {option.label}
                  </option>
                ))}
              </Select>
            )}
          </Field>

          {errors.length > 0 ? (
            <ul className={styles.errors} role="alert">
              {errors.map((message) => (
                <li key={message}>{message}</li>
              ))}
            </ul>
          ) : null}

          <Button type="submit" className={styles.wide} disabled={saving}>
            {saving ? 'Saving…' : 'Save correction'}
          </Button>
          <Button
            type="button"
            variant="secondary"
            className={styles.wide}
            onClick={() => {
              setCorrecting(false);
              setDraft(null);
              setErrors([]);
            }}
          >
            Cancel
          </Button>
        </form>
      ) : (
        <>
          <section className={styles.block}>
            <h2 className={styles.blockHead}>Topics</h2>
            <p className={styles.body}>
              {visit.topics.map((t) => VISIT_TOPIC_LABELS[t] ?? t).join(' · ')}
            </p>
          </section>

          <section className={styles.block}>
            <h2 className={styles.blockHead}>Advice given</h2>
            <p className={styles.body} dir="auto">
              {visit.advice}
            </p>
          </section>

          {/*
            ABSENT IS NOT EMPTY. An observation that was never written is not
            shown as a dash or as "None" -- the section simply is not there,
            because nothing was recorded and inventing a placeholder would
            report a fact nobody stated (C-5.8).
          */}
          {visit.observation !== null ? (
            <section className={styles.block}>
              <h2 className={styles.blockHead}>What was seen</h2>
              <p className={styles.body} dir="auto">
                {visit.observation}
              </p>
            </section>
          ) : null}

          {visit.duration_minutes !== null || visit.attendee_count !== null ? (
            <section className={styles.block}>
              <h2 className={styles.blockHead}>Details</h2>
              <dl className={styles.facts}>
                {visit.duration_minutes !== null ? (
                  <div>
                    <dt>Minutes</dt>
                    <dd className="mono">{visit.duration_minutes}</dd>
                  </div>
                ) : null}
                {visit.attendee_count !== null ? (
                  <div>
                    <dt>People present</dt>
                    <dd className="mono">{visit.attendee_count}</dd>
                  </div>
                ) : null}
              </dl>
            </section>
          ) : null}

          {/*
            The position is returned only to an administrator and the visit's
            own officer (C-8.4 with C-7.8). When it is withheld the KEY IS
            ABSENT, so this asks whether it is there rather than treating a
            missing reading as a missing visit.
          */}
          {visit.position ? (
            <section className={styles.block}>
              <h2 className={styles.blockHead}>Where it happened</h2>
              <p className={styles.body}>
                <span className="mono">{visit.position.coordinates[1].toFixed(5)}</span>,{' '}
                <span className="mono">{visit.position.coordinates[0].toFixed(5)}</span>
                {/*
                  A visit's accuracy arrives as raw metres -- unlike a farm
                  boundary, the route computes no grade for it -- so the grade
                  is read off the SHARED `gradeAccuracy`, never a scale of this
                  screen's own.
                */}
                {visit.gps_accuracy_m !== undefined ? (
                  <>
                    {' '}
                    · accurate to about <span className="mono">{visit.gps_accuracy_m}</span> m{' '}
                    <span className={styles[`grade_${gradeAccuracy(visit.gps_accuracy_m)}`]}>
                      {gradeAccuracy(visit.gps_accuracy_m)}
                    </span>
                  </>
                ) : null}
              </p>
            </section>
          ) : null}

          {/*
            The two directions, stated plainly. `follow_up_of` on the visit
            says THAT it follows something even when the chain has not loaded;
            the chain supplies the date.
          */}
          {visit.follow_up_of !== null || followUps.length > 0 ? (
            <section className={styles.block} aria-labelledby="chain-h">
              <h2 id="chain-h" className={styles.blockHead}>
                Follow-up
              </h2>
              {visit.follow_up_of !== null ? <Follows link={parentOf(earlier)} /> : null}
              {followUps.map((later) => (
                <p key={later.id} className={styles.body}>
                  Followed up by{' '}
                  <Link href={`/visits/${later.id}`} className={styles.chainLink}>
                    the visit of {formatDate(later.visited_at)}
                  </Link>
                </p>
              ))}
            </section>
          ) : null}

          <VisitAttachments visit={visit} />

          {window.canCorrect ? (
            <>
              <Button
                className={styles.wide}
                onClick={() => {
                  setDraft(correctionDraftFrom(visit));
                  setCorrecting(true);
                }}
              >
                Correct this visit
              </Button>
              <p className={styles.note}>
                You can correct what you wrote until{' '}
                {window.closesAt ? deadline(window.closesAt) : 'the window closes'}. The place, the
                time and the farmer are what the field recorded and do not change.
              </p>
            </>
          ) : (
            <p className={styles.note}>
              {window.reason === 'closed'
                ? 'The day for correcting this visit has passed. Ask a supervisor if something in it is wrong.'
                : 'This visit was recorded by another officer, so it is not yours to correct.'}
            </p>
          )}
        </>
      )}
    </div>
  );
}

/** The immediate parent is the last of the ancestors, which arrive oldest first. */
function parentOf(earlier: readonly ChainLink[]): ChainLink | null {
  return earlier.length > 0 ? (earlier[earlier.length - 1] ?? null) : null;
}

function Follows({ link }: { link: ChainLink | null }) {
  if (!link) {
    // The visit says it follows something, but the chain has not arrived (or
    // the ancestor is not readable). Say the first without inventing the second.
    return <p className={styles.body}>This visit continues an earlier one.</p>;
  }
  if (isRemovedLink(link)) {
    return <p className={styles.body}>Follows an earlier visit that has since been removed.</p>;
  }
  return (
    <p className={styles.body}>
      Follow-up to{' '}
      <Link href={`/visits/${link.id}`} className={styles.chainLink}>
        the visit of {formatDate(link.visited_at)}
      </Link>
    </p>
  );
}
