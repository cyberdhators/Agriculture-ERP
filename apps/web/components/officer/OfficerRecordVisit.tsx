'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';

import { Button, ButtonLink, Field, Input, Select, Textarea } from '@/components/ui';
import { UnavailableState } from '@/components/ui/data';
import { getFarmer, LIVE_FARMERS } from '@/lib/farmers/api';
import type { Farmer } from '@/lib/fixtures/farmers';
import { createVisit, listFarmerVisits, LIVE_VISITS, type Visit } from '@/lib/visits/api';
import { VISIT_TOPIC_LABELS } from '@/lib/visits/fixtures';
import { formatDate } from '@/lib/format';
import {
  buildVisit,
  emptyVisitDraft,
  TOPICS,
  toggleTopic,
  visitProblems,
  type Fix,
  type VisitDraft,
} from '@/lib/officer/visits';
import { classify, classifyFix, unsupportedFix, type FixRecovery } from '@/lib/officer/recovery';

import { VisitAttachments } from './VisitAttachments';
import styles from './officer-visits.module.css';

/**
 * RECORDING A VISIT, STANDING IN A FIELD.
 *
 * THE FARMER IS THE URL'S, NOT A PICKER'S. The route is
 * `POST /api/farmers/:id/visits`; `recordVisitSchema` has no `farmer_id`, so
 * there is no hidden field to tamper with, and `loadVisible` answers 404 for a
 * farmer outside this officer's caseload before the handler runs. This screen
 * never fetches a list of farmers and never compares ownership itself.
 *
 * THE POSITION IS THE DEVICE'S READING. `position` and `gps_accuracy_m` are
 * REQUIRED by the contract and stored as PostGIS geography, so a visit cannot
 * be recorded without one. The reading comes from `navigator.geolocation`,
 * whose longitude, latitude and accuracy are exactly the three the route wants.
 * Nothing is remembered between visits and nothing is guessed: if the device
 * refuses or fails, this says so and offers to try again. A visit with an
 * invented position would be worse than no visit at all.
 *
 * THE ATTACHMENTS COME AFTER. The visit is saved first and completely; only
 * then does anything about photographs appear, because an attachment belongs
 * to a visit that exists. There is no queue and no retry loop here -- working
 * without a signal is the Android application's job and is not built.
 */
type Phase = 'loading' | 'ready' | 'notfound' | 'error';

export function OfficerRecordVisit({ farmerId }: { farmerId: string }) {
  const [farmer, setFarmer] = useState<Farmer | null>(null);
  const [phase, setPhase] = useState<Phase>('loading');

  const [draft, setDraft] = useState<VisitDraft>(() => emptyVisitDraft());
  const [fix, setFix] = useState<Fix | null>(null);
  const [locating, setLocating] = useState(false);
  const [fixError, setFixError] = useState<FixRecovery | null>(null);

  /**
   * EARLIER VISITS TO THIS FARMER, for the optional follow-up link.
   *
   * Read from `GET /api/farmers/:id/visits` -- the farmer-scoped route, which
   * `loadVisible` already refuses outside the caseload. So every option is a
   * visit this officer is authorised to see AND is for the right farmer, which
   * are precisely the two things the follow-up contract requires. There is no
   * global visit list here and no free-text id: the officer can only name a
   * visit the server itself just handed them.
   *
   * NOT filtered to this officer's own visits. The contract scopes a follow-up
   * by FARMER, not by officer, and a farmer whose caseload was reassigned has
   * earlier visits from another officer that are legitimately followed up.
   * Narrowing here would invent a rule the server does not have.
   */
  const [earlier, setEarlier] = useState<readonly Visit[]>([]);

  const [submitted, setSubmitted] = useState(false);
  const [saving, setSaving] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const [saved, setSaved] = useState<Visit | null>(null);

  useEffect(() => {
    if (!LIVE_FARMERS) {
      setPhase('error');
      return;
    }
    let on = true;
    getFarmer(farmerId)
      .then((row) => {
        if (!on) return;
        setFarmer(row);
        setPhase('ready');
      })
      .catch((e: { status?: number }) => {
        if (!on) return;
        setPhase(e?.status === 404 ? 'notfound' : 'error');
      });
    return () => {
      on = false;
    };
  }, [farmerId]);

  useEffect(() => {
    if (!LIVE_VISITS) return;
    let on = true;
    listFarmerVisits(farmerId, { limit: 20 })
      .then((page) => on && setEarlier(page.visits))
      .catch(() => {
        // No earlier visits offered; the visit itself is unaffected.
      });
    return () => {
      on = false;
    };
  }, [farmerId]);

  /** One reading, taken on purpose. Never stored, never reused. */
  const takeFix = useCallback(() => {
    setFixError(null);
    if (typeof navigator === 'undefined' || !navigator.geolocation) {
      setFixError(unsupportedFix());
      return;
    }
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      (position) => {
        setFix({
          longitude: position.coords.longitude,
          latitude: position.coords.latitude,
          accuracy_m: Math.round(position.coords.accuracy),
        });
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

  const problems = useMemo(() => visitProblems(draft, fix), [draft, fix]);
  const problemFor = (field: string) =>
    submitted ? problems.find((p) => p.field === field)?.message : undefined;
  const set = (patch: Partial<VisitDraft>) => setDraft({ ...draft, ...patch });

  if (phase === 'loading') {
    return (
      <div className={styles.page}>
        <div className={styles.skeleton} aria-busy="true" aria-label="Loading the farmer" />
      </div>
    );
  }

  if (phase === 'notfound') {
    return (
      <div className={styles.page}>
        <UnavailableState title="This farmer is not on your caseload">
          Either there is no such record, or it belongs to another officer. Both look the same from
          here, and that is deliberate.
        </UnavailableState>
      </div>
    );
  }

  if (phase === 'error' || !farmer) {
    return (
      <div className={styles.page}>
        <UnavailableState title="This farmer could not be loaded">
          {LIVE_FARMERS
            ? 'The record could not be read just now. Nothing has changed.'
            : 'This deployment is running on preview data, so no farmer is read.'}
        </UnavailableState>
      </div>
    );
  }

  /* ---- Saved: the visit exists, and only now do attachments appear ---- */
  if (saved) {
    return (
      <div className={styles.page}>
        <div className={styles.done}>
          <p className={styles.doneLabel}>Visit recorded</p>
          <p className={styles.doneName} dir="auto">
            {farmer.given_name} {farmer.family_name}
          </p>
          <p className={styles.note}>
            Saved on the server. The advice is on the record and cannot be unsaid.
          </p>
        </div>

        <VisitAttachments visit={saved} />

        <div className={styles.doneActions}>
          <ButtonLink href={`/farmers/${farmer.id}`} className={styles.wide}>
            Back to farmer
          </ButtonLink>
          <ButtonLink href="/visits" variant="secondary" className={styles.wide}>
            My visits
          </ButtonLink>
        </div>
      </div>
    );
  }

  const submit = () => {
    setSubmitted(true);
    setFailure(null);
    if (problems.length > 0 || !fix) return;
    if (!LIVE_VISITS) {
      setFailure('This deployment is running on preview data, so nothing was sent.');
      return;
    }
    setSaving(true);
    createVisit(
      farmer.id,
      buildVisit(draft, fix, () => crypto.randomUUID()),
    )
      .then(setSaved)
      .catch((error: unknown) => setFailure(classify(error).explanation))
      .finally(() => setSaving(false));
  };

  return (
    <div className={styles.page}>
      <Link href={`/farmers/${farmer.id}`} className={styles.back}>
        ← Back to farmer
      </Link>
      <h1 className={styles.title}>Record a visit</h1>
      <p className={styles.sub} dir="auto">
        {farmer.given_name} {farmer.family_name} ·{' '}
        <span className="mono">{farmer.farmer_number}</span>
      </p>

      <form
        className={styles.form}
        onSubmit={(event) => {
          event.preventDefault();
          submit();
        }}
      >
        {/* WHERE. Required by the contract; taken from the device, never typed. */}
        <section className={styles.block} aria-labelledby="where-h">
          <h2 id="where-h" className={styles.blockHead}>
            Where you are
          </h2>
          {fix ? (
            <p className={styles.fixOk}>
              Position recorded, accurate to about <span className="mono">{fix.accuracy_m}</span> m.
            </p>
          ) : (
            <p className={styles.note}>
              A visit records where it happened. Take the reading while you are with the farmer.
            </p>
          )}
          <Button
            type="button"
            variant={fix ? 'secondary' : 'primary'}
            className={styles.wide}
            onClick={takeFix}
            disabled={locating}
          >
            {locating ? 'Reading the position…' : fix ? 'Take it again' : 'Take GPS reading'}
          </Button>
          {fixError ? (
            <p className={styles.fieldError} role="alert">
              <strong className={styles.problemTitle}>{fixError.title}</strong>{' '}
              {fixError.explanation}
            </p>
          ) : null}
          {problemFor('position') ? (
            <p className={styles.fieldError}>{problemFor('position')}</p>
          ) : null}
        </section>

        {/* WHEN. Defaults to now; an officer writing up later can move it back. */}
        <Field
          label="When the visit happened"
          hint="Defaults to now. Change it if you are writing up later."
          error={problemFor('visited_at')}
        >
          {(ids) => (
            <Input
              {...ids}
              type="datetime-local"
              value={draft.visited_at}
              onChange={(e) => set({ visited_at: e.target.value })}
            />
          )}
        </Field>

        {/* WHAT IT COVERED. The nine, from the shared list. Several may apply. */}
        <section className={styles.block} aria-labelledby="topics-h">
          <h2 id="topics-h" className={styles.blockHead}>
            What the visit covered
          </h2>
          <p className={styles.note}>Tick every topic you discussed. At least one.</p>
          <div className={styles.topics} role="group" aria-labelledby="topics-h">
            {TOPICS.map((topic) => {
              const on = draft.topics.includes(topic);
              return (
                <button
                  key={topic}
                  type="button"
                  className={`${styles.topic} ${on ? styles.topicOn : ''}`}
                  aria-pressed={on}
                  onClick={() => set({ topics: toggleTopic(draft.topics, topic) })}
                >
                  {VISIT_TOPIC_LABELS[topic]}
                </button>
              );
            })}
          </div>
          {problemFor('topics') ? (
            <p className={styles.fieldError}>{problemFor('topics')}</p>
          ) : null}
        </section>

        {/*
          ADVICE IS REQUIRED, and the schema says so -- this is not a second
          rule. The hint says what belongs here because "advice" alone invites
          a single word.
        */}
        <Field
          label="Advice you gave"
          hint="What you told the farmer to do, in the words you used. This is the record of the visit."
          error={problemFor('advice')}
        >
          {(ids) => (
            <Textarea
              {...ids}
              rows={5}
              value={draft.advice}
              className={styles.advice}
              onChange={(e) => set({ advice: e.target.value })}
            />
          )}
        </Field>

        <Field
          label="What you saw (optional)"
          hint="The condition of the crop or the farm. Leave it empty if there is nothing to add."
          error={problemFor('observation')}
        >
          {(ids) => (
            <Textarea
              {...ids}
              rows={3}
              value={draft.observation}
              onChange={(e) => set({ observation: e.target.value })}
            />
          )}
        </Field>

        <div className={styles.pair}>
          <Field label="Minutes (optional)" error={problemFor('duration_minutes')}>
            {(ids) => (
              <Input
                {...ids}
                inputMode="numeric"
                value={draft.duration_minutes}
                onChange={(e) => set({ duration_minutes: e.target.value })}
              />
            )}
          </Field>
          <Field label="People present (optional)" error={problemFor('attendee_count')}>
            {(ids) => (
              <Input
                {...ids}
                inputMode="numeric"
                value={draft.attendee_count}
                onChange={(e) => set({ attendee_count: e.target.value })}
              />
            )}
          </Field>
        </div>

        {/*
          FOLLOW-UP. Optional, and only shown when there is something to follow:
          an empty selector would imply the officer had missed something.
          "None" is the default and sends no key at all.
        */}
        {earlier.length > 0 ? (
          <Field
            label="Follow-up to an earlier visit (optional)"
            hint="Link this visit to the one it continues, so the advice reads in order."
            error={problemFor('follow_up_of')}
          >
            {(ids) => (
              <Select
                {...ids}
                value={draft.follow_up_of}
                onChange={(e) => set({ follow_up_of: e.target.value })}
              >
                <option value="">Not a follow-up</option>
                {earlier.map((visit) => (
                  <option key={visit.id} value={visit.id}>
                    {formatDate(visit.visited_at)} ·{' '}
                    {visit.topics.map((t) => VISIT_TOPIC_LABELS[t] ?? t).join(', ')}
                  </option>
                ))}
              </Select>
            )}
          </Field>
        ) : null}

        {submitted && problems.length > 0 ? (
          <p className={styles.formError} role="alert">
            {problems.length === 1
              ? 'One thing still needs attention.'
              : `${problems.length} things still need attention.`}
          </p>
        ) : null}
        {failure ? (
          <p className={styles.formError} role="alert">
            {failure}
          </p>
        ) : null}

        <Button type="submit" className={styles.wide} disabled={saving}>
          {saving ? 'Saving…' : 'Save visit'}
        </Button>
        <p className={styles.note}>
          You can correct what you wrote for twenty-four hours after the server receives it. Photos
          and recordings are added after the visit is saved.
        </p>
      </form>
    </div>
  );
}
