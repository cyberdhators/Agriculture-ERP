'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';

import { patchFarmerSchema } from '@agri-erp/shared';

import { Button, Field, Input, Select } from '@/components/ui';
import { UnavailableState } from '@/components/ui/data';
import { LIVE_FARMERS, getFarmer, patchFarmer } from '@/lib/farmers/api';
import type { Farmer } from '@/lib/fixtures/farmers';
import { usePreview } from '@/lib/preview';
import {
  canMoveToMyPayam,
  draftFrom,
  editEligibility,
  isEmptyPatch,
  mayEditNationalId,
  patchBody,
  type EditDraft,
} from '@/lib/officer/farmer-edit';
import { classify } from '@/lib/officer/recovery';

import styles from './officer-farmer-edit.module.css';

/**
 * CORRECTING ONE'S OWN FARMER, ON A PHONE.
 *
 * THIS SCREEN EXISTS BECAUSE THE LINK TO IT DID NOT. The officer detail screen
 * offered "Edit details" pointing at `/farmers/[id]/edit`, and no such route
 * existed -- a dead link shipped in the previous pass. Officers also lost the
 * inline correction the dossier gives every other role the moment they were
 * branched away from it. This is that capability back, in a shape that suits a
 * field worker.
 *
 * EVERY RULE IS THE ROUTE'S. `PATCH /api/farmers/:id` accepts admin and
 * officer; `loadVisible` puts the caseload clause in the WHERE, so another
 * officer's farmer is a 404 here exactly as it is everywhere else; an officer
 * may patch only a `pending` or `rejected` record; and `payam_id`, if sent at
 * all, must equal the officer's own payam. The form mirrors those rather than
 * inventing its own, and `patchFarmerSchema` is strict, so a field it does not
 * name cannot be sent whatever this screen does.
 *
 * SAVING IS NOT RESUBMITTING. The route patches; resubmission is its own call
 * to its own endpoint. A save that quietly sent a record back for review would
 * make a correction into a decision the officer did not take, so the two stay
 * separate and resubmission lives on the detail screen where it is deliberate.
 */
type Phase = 'loading' | 'ready' | 'notfound' | 'error';

export function OfficerFarmerEdit({ id }: { id: string }) {
  const router = useRouter();
  const { me } = usePreview();
  const myPayamId = me?.scope?.kind === 'caseload' ? me.scope.payamId : null;

  const [farmer, setFarmer] = useState<Farmer | null>(null);
  const [draft, setDraft] = useState<EditDraft | null>(null);
  const [phase, setPhase] = useState<Phase>('loading');
  const [why, setWhy] = useState<string | null>(null);
  const [errors, setErrors] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    if (!LIVE_FARMERS) {
      setPhase('error');
      setWhy('preview');
      return;
    }
    setPhase('loading');
    try {
      const row = await getFarmer(id);
      setFarmer(row);
      setDraft(draftFrom(row));
      setPhase('ready');
    } catch (failure) {
      const status = (failure as { status?: number }).status;
      setPhase(status === 404 ? 'notfound' : 'error');
      setWhy(status === 404 ? null : 'unreachable');
    }
  }, [id]);

  useEffect(() => {
    void load();
  }, [load]);

  if (phase === 'loading') {
    return (
      <div className={styles.page}>
        <BackLink id={id} />
        <div className={styles.skeleton} aria-busy="true" aria-label="Loading the farmer" />
      </div>
    );
  }

  if (phase === 'notfound') {
    return (
      <div className={styles.page}>
        <BackLink id={id} />
        <UnavailableState title="This farmer is not on your caseload">
          Either there is no such record, or it belongs to another officer. Both look the same from
          here, and that is deliberate.
        </UnavailableState>
      </div>
    );
  }

  if (phase === 'error' || !farmer || !draft) {
    return (
      <div className={styles.page}>
        <BackLink id={id} />
        <UnavailableState title="This farmer could not be loaded">
          {why === 'preview'
            ? 'This deployment is running on preview data, so no farmer is read.'
            : 'The record could not be read just now. Nothing has changed — it was not fetched.'}
        </UnavailableState>
      </div>
    );
  }

  const eligibility = editEligibility(farmer);
  if (!eligibility.canEdit) {
    return (
      <div className={styles.page}>
        <BackLink id={id} />
        <UnavailableState
          title={
            eligibility.refusal === 'merged'
              ? 'This record has been merged into another'
              : 'This record is no longer yours to change'
          }
        >
          {eligibility.refusal === 'merged'
            ? 'A merged record is kept as history and is not edited.'
            : 'A verified registration is changed by a supervisor. You can still correct a record while it is pending or rejected.'}
        </UnavailableState>
      </div>
    );
  }

  const canMove = canMoveToMyPayam(farmer, myPayamId);
  const editNationalId = mayEditNationalId(farmer);

  const save = () => {
    const body = patchBody(farmer, draft, myPayamId);
    if (isEmptyPatch(body)) {
      setErrors(['Nothing has been changed yet.']);
      return;
    }
    const parsed = patchFarmerSchema.safeParse(body);
    if (!parsed.success) {
      setErrors(parsed.error.issues.map((issue) => issue.message));
      return;
    }
    setErrors([]);
    setSaving(true);
    patchFarmer(farmer.id, parsed.data)
      .then(() => router.push(`/farmers/${farmer.id}`))
      .catch((failure: unknown) => setErrors([classify(failure).explanation]))
      .finally(() => setSaving(false));
  };

  const set = (patch: Partial<EditDraft>) => setDraft({ ...draft, ...patch });

  return (
    <div className={styles.page}>
      <BackLink id={id} />
      <h1 className={styles.title}>Correct this record</h1>
      <p className={styles.sub}>
        <span className="mono">{farmer.farmer_number}</span> ·{' '}
        {farmer.verification_status === 'rejected' ? 'Rejected' : 'Pending verification'}
      </p>

      <form
        className={styles.form}
        onSubmit={(event) => {
          event.preventDefault();
          save();
        }}
      >
        <Field label="Given name">
          {(ids) => (
            <Input
              {...ids}
              value={draft.given_name}
              autoComplete="off"
              onChange={(e) => set({ given_name: e.target.value })}
            />
          )}
        </Field>

        <Field label="Family name">
          {(ids) => (
            <Input
              {...ids}
              value={draft.family_name}
              autoComplete="off"
              onChange={(e) => set({ family_name: e.target.value })}
            />
          )}
        </Field>

        <Field label="Phone" hint="The number the farmer answers.">
          {(ids) => (
            <Input
              {...ids}
              value={draft.phone}
              inputMode="tel"
              autoComplete="off"
              onChange={(e) => set({ phone: e.target.value })}
            />
          )}
        </Field>

        <Field label="Sex">
          {(ids) => (
            <Select
              {...ids}
              value={draft.sex}
              onChange={(e) => set({ sex: e.target.value as Farmer['sex'] })}
            >
              <option value="f">Female</option>
              <option value="m">Male</option>
            </Select>
          )}
        </Field>

        <Field label="Year of birth">
          {(ids) => (
            <Input
              {...ids}
              value={draft.year_of_birth}
              inputMode="numeric"
              onChange={(e) => set({ year_of_birth: e.target.value })}
            />
          )}
        </Field>

        {/*
          Rendered only when the route sent the key. A withheld id is not an
          empty box an officer could "save" as a deliberate clearing of
          something they were never shown (C-5.8).
        */}
        {editNationalId ? (
          <Field label="National ID" hint="Leave empty if the farmer has none.">
            {(ids) => (
              <Input
                {...ids}
                value={draft.national_id}
                autoComplete="off"
                onChange={(e) => set({ national_id: e.target.value })}
              />
            )}
          </Field>
        ) : null}

        {/*
          The one legal location change. `payam_id` is accepted only when it
          equals the officer's own payam, so there is nothing to choose between
          -- only whether to make the move.
        */}
        {canMove && myPayamId ? (
          <label className={styles.move}>
            <input
              type="checkbox"
              checked={draft.moveToMyPayam}
              onChange={(e) => set({ moveToMyPayam: e.target.checked })}
            />
            <span>
              Move to my payam (<span className="mono">{myPayamId}</span>). Recorded as{' '}
              <span className="mono">{farmer.payam_id}</span> today.
            </span>
          </label>
        ) : null}

        {errors.length > 0 ? (
          <ul className={styles.errors} role="alert">
            {errors.map((message) => (
              <li key={message}>{message}</li>
            ))}
          </ul>
        ) : null}

        <div className={styles.actions}>
          <Button type="submit" className={styles.save} disabled={saving}>
            {saving ? 'Saving…' : 'Save changes'}
          </Button>
          <Button
            type="button"
            variant="secondary"
            className={styles.cancel}
            onClick={() => router.push(`/farmers/${farmer.id}`)}
          >
            Cancel
          </Button>
        </div>

        <p className={styles.note}>
          Saving does not send this record back for review. Use “Correct and resubmit” on the
          farmer’s page when it is ready.
        </p>
      </form>
    </div>
  );
}

function BackLink({ id }: { id: string }) {
  return (
    <Link href={`/farmers/${id}`} className={styles.back}>
      ← Back to farmer
    </Link>
  );
}
