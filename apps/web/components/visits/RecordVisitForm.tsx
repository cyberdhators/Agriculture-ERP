'use client';

import { useState } from 'react';

import {
  recordVisitSchema,
  VISIT_TOPICS,
  type RecordVisit,
  type VisitTopic,
} from '@agri-erp/shared';

import { Button, Checkbox, Dialog, Field, Input, Notice, Select, Textarea } from '@/components/ui';
import { createVisit, LIVE_VISITS, VisitApiError, type Visit } from '@/lib/visits/api';
import { FARMER_OPTIONS, VISIT_TOPIC_LABELS, type FarmerOption } from '@/lib/visits/fixtures';
import { newId } from '@/lib/preview';

import styles from './visits.module.css';

type Values = {
  farmer_id: string;
  visited_at: string;
  longitude: string;
  latitude: string;
  gps_accuracy_m: string;
  advice: string;
  observation: string;
  duration_minutes: string;
  attendee_count: string;
  topics: VisitTopic[];
};

type FieldErrors = Partial<
  Record<'farmer_id' | 'position' | 'gps_accuracy_m' | keyof Values, string>
>;

function nowLocalInput(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function initialValues(): Values {
  return {
    farmer_id: '',
    visited_at: nowLocalInput(),
    longitude: '',
    latitude: '',
    gps_accuracy_m: '',
    advice: '',
    observation: '',
    duration_minutes: '',
    attendee_count: '',
    topics: [],
  };
}

/**
 * Record an extension visit (C-8.1). Validated with the same Zod schema the API
 * uses (`recordVisitSchema` in packages/shared), so the form says exactly what
 * the server would. When `NEXT_PUBLIC_USE_LIVE_VISITS=1` it POSTs to
 * /api/farmers/:id/visits; otherwise it builds the record locally so the log
 * can be walked before an officer is signed in. Either way it shows a receipt
 * of what was recorded before returning to the log.
 */
export function RecordVisitForm({
  farmers = FARMER_OPTIONS,
  onRecorded,
  onClose,
}: {
  farmers?: readonly FarmerOption[];
  onRecorded: (visit: Visit) => void;
  onClose: () => void;
}) {
  const [values, setValues] = useState<Values>(initialValues);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState<string | undefined>();
  const [busy, setBusy] = useState(false);
  const [receipt, setReceipt] = useState<Visit | null>(null);

  const set = <K extends keyof Values>(key: K, value: Values[K]) =>
    setValues((v) => ({ ...v, [key]: value }));

  function toggleTopic(topic: VisitTopic) {
    setValues((v) => ({
      ...v,
      topics: v.topics.includes(topic) ? v.topics.filter((t) => t !== topic) : [...v.topics, topic],
    }));
  }

  /** Build the request body and validate it against the shared schema. */
  function validate(): { body: RecordVisit; farmer: FarmerOption } | null {
    const next: FieldErrors = {};
    const farmer = farmers.find((f) => f.id === values.farmer_id);
    if (!farmer) next.farmer_id = 'Choose the farmer this visit was for.';

    const lng = Number(values.longitude);
    const lat = Number(values.latitude);
    const payload: Record<string, unknown> = {
      id: newId(),
      visited_at: values.visited_at ? new Date(values.visited_at).toISOString() : '',
      position: {
        type: 'Point',
        coordinates: [values.longitude === '' ? NaN : lng, values.latitude === '' ? NaN : lat],
      },
      gps_accuracy_m: values.gps_accuracy_m === '' ? NaN : Number(values.gps_accuracy_m),
      advice: values.advice,
      topics: values.topics,
    };
    if (values.observation.trim()) payload.observation = values.observation.trim();
    if (values.duration_minutes !== '') payload.duration_minutes = Number(values.duration_minutes);
    if (values.attendee_count !== '') payload.attendee_count = Number(values.attendee_count);

    const result = recordVisitSchema.safeParse(payload);
    if (!result.success) {
      for (const issue of result.error.issues) {
        const head = issue.path[0];
        const key = head === 'position' ? 'position' : (head as keyof FieldErrors);
        if (key && !next[key]) next[key] = issue.message;
      }
    }
    setErrors(next);
    if (!result.success || !farmer) return null;
    return { body: result.data, farmer };
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    const validated = validate();
    if (!validated) return;
    const { body, farmer } = validated;
    setBusy(true);
    setFormError(undefined);
    try {
      let visit: Visit;
      if (LIVE_VISITS) {
        visit = await createVisit(farmer.id, body);
      } else {
        const now = new Date().toISOString();
        visit = {
          id: body.id,
          farmer_id: farmer.id,
          officer_id: 'you',
          payam_id: farmer.payam_id,
          county_id: farmer.county_id,
          state_id: farmer.state_id,
          visited_at: body.visited_at,
          received_at: now,
          observation: body.observation ?? null,
          advice: body.advice,
          topics: body.topics,
          duration_minutes: body.duration_minutes ?? null,
          attendee_count: body.attendee_count ?? null,
          follow_up_of: body.follow_up_of ?? null,
          created_at: now,
          updated_at: now,
          attachments: [],
          position: body.position,
          gps_accuracy_m: body.gps_accuracy_m,
        };
      }
      setReceipt(visit);
    } catch (err) {
      setFormError(
        err instanceof VisitApiError
          ? err.message
          : 'Could not record the visit. Please try again.',
      );
    } finally {
      setBusy(false);
    }
  }

  function done() {
    if (receipt) onRecorded(receipt);
    onClose();
  }

  if (receipt) {
    const farmer = farmers.find((f) => f.id === receipt.farmer_id);
    return (
      <Dialog
        open
        onClose={done}
        title="Visit recorded"
        footer={
          <Button variant="primary" type="button" onClick={done}>
            Back to visits
          </Button>
        }
      >
        <Notice kind="success" title={`Recorded for ${farmer?.name ?? receipt.farmer_id}`}>
          <ul className="small">
            <li>{new Date(receipt.visited_at).toLocaleString('en-GB')}</li>
            <li>{receipt.topics.map((t) => VISIT_TOPIC_LABELS[t]).join(', ')}</li>
            <li dir="auto">{receipt.advice}</li>
          </ul>
        </Notice>
      </Dialog>
    );
  }

  return (
    <Dialog
      open
      onClose={onClose}
      title="Record a visit"
      footer={
        <>
          <Button variant="ghost" type="button" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button variant="primary" type="submit" form="record-visit-form" disabled={busy}>
            Record visit
          </Button>
        </>
      }
    >
      <form id="record-visit-form" onSubmit={submit} noValidate>
        {formError ? (
          <Notice kind="error">
            <p className="small">{formError}</p>
          </Notice>
        ) : null}

        <Field label="Farmer" error={errors.farmer_id}>
          {(ids) => (
            <Select
              {...ids}
              value={values.farmer_id}
              onChange={(e) => set('farmer_id', e.target.value)}
            >
              <option value="">Choose a farmer…</option>
              {farmers.map((f) => (
                <option key={f.id} value={f.id}>
                  {f.name}
                </option>
              ))}
            </Select>
          )}
        </Field>

        <Field label="Date and time of visit" error={errors.visited_at}>
          {(ids) => (
            <Input
              {...ids}
              type="datetime-local"
              value={values.visited_at}
              onChange={(e) => set('visited_at', e.target.value)}
            />
          )}
        </Field>

        <Field
          label="Topics covered"
          error={errors.topics}
          hint="Tick every topic the visit covered."
        >
          {() => (
            <div className={styles.topics}>
              {VISIT_TOPICS.map((topic) => (
                <Checkbox
                  key={topic}
                  label={VISIT_TOPIC_LABELS[topic]}
                  checked={values.topics.includes(topic)}
                  onChange={() => toggleTopic(topic)}
                />
              ))}
            </div>
          )}
        </Field>

        <Field label="Advice given" error={errors.advice}>
          {(ids) => (
            <Textarea
              {...ids}
              rows={3}
              dir="auto"
              value={values.advice}
              onChange={(e) => set('advice', e.target.value)}
            />
          )}
        </Field>

        <Field label="What you observed" optional error={errors.observation}>
          {(ids) => (
            <Textarea
              {...ids}
              rows={2}
              dir="auto"
              value={values.observation}
              onChange={(e) => set('observation', e.target.value)}
            />
          )}
        </Field>

        <div className={styles.grid2}>
          <Field label="Duration (minutes)" optional error={errors.duration_minutes}>
            {(ids) => (
              <Input
                {...ids}
                type="number"
                inputMode="numeric"
                min={1}
                value={values.duration_minutes}
                onChange={(e) => set('duration_minutes', e.target.value)}
              />
            )}
          </Field>
          <Field label="People present" optional error={errors.attendee_count}>
            {(ids) => (
              <Input
                {...ids}
                type="number"
                inputMode="numeric"
                min={1}
                value={values.attendee_count}
                onChange={(e) => set('attendee_count', e.target.value)}
              />
            )}
          </Field>
        </div>

        <Field
          label="Where the visit happened"
          error={errors.position}
          hint="Longitude and latitude of the field, as the officer app captures them."
        >
          {() => (
            <div className={styles.grid2}>
              <Input
                aria-label="Longitude"
                type="number"
                inputMode="decimal"
                placeholder="Longitude"
                className="mono"
                value={values.longitude}
                onChange={(e) => set('longitude', e.target.value)}
              />
              <Input
                aria-label="Latitude"
                type="number"
                inputMode="decimal"
                placeholder="Latitude"
                className="mono"
                value={values.latitude}
                onChange={(e) => set('latitude', e.target.value)}
              />
            </div>
          )}
        </Field>

        <Field label="GPS accuracy (metres)" error={errors.gps_accuracy_m}>
          {(ids) => (
            <Input
              {...ids}
              type="number"
              inputMode="decimal"
              min={0}
              className="mono"
              value={values.gps_accuracy_m}
              onChange={(e) => set('gps_accuracy_m', e.target.value)}
            />
          )}
        </Field>
      </form>
    </Dialog>
  );
}
