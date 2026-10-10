'use client';

import { useSearchParams } from 'next/navigation';
import { useEffect, useState } from 'react';

import {
  CROPS,
  LAND_TENURES,
  LAND_UNITS,
  recordFarmSchema,
  type Crop,
  type RecordFarmInput,
} from '@agri-erp/shared';

import { getFarmer } from '@/lib/farmers/api';
import { FarmApiError, recordFarm } from '@/lib/farms/api';
import type { Farmer } from '@/lib/fixtures/farmers';
import { CROP_LABELS } from '@/lib/format';
import { isNoSignal, offlineNow } from '@/lib/offline/net';
import { farmerOnPhone, queueFarm } from '@/lib/offline/officer';
import { usePreview } from '@/lib/preview';

import {
  Button,
  ButtonLink,
  Card,
  Checkbox,
  Field,
  Input,
  Notice,
  PageHeader,
  Select,
  Textarea,
} from '../ui';
import screens from '../screens.module.css';
import styles from '../farmers/farmers.module.css';

export const UNIT_LABELS: Record<(typeof LAND_UNITS)[number], string> = {
  feddan: 'Feddans',
  acre: 'Acres',
  hectare: 'Hectares',
};

export const TENURE_LABELS: Record<(typeof LAND_TENURES)[number], string> = {
  owned: 'Owned',
  rented: 'Rented',
  communal: 'Communal',
  other: 'Other',
};

const SEASON_LABELS = { main: 'Main season', second: 'Second season' } as const;

/** This year's two seasons and last year's, newest first. */
function seasonOptions(now = new Date()): string[] {
  const y = now.getFullYear();
  return [`${y}-main`, `${y}-second`, `${y - 1}-second`, `${y - 1}-main`];
}

const seasonLabel = (s: string) => {
  const [year, name] = s.split('-') as [string, keyof typeof SEASON_LABELS];
  return `${SEASON_LABELS[name] ?? name} ${year}`;
};

type Values = {
  season: string;
  name: string;
  size_value: string;
  size_unit: string;
  tenure: string;
  village: string;
  location_note: string;
  crops: Crop[];
  notes: string;
};

type Point = { latitude: number; longitude: number; accuracy_m: number };

type Errors = Partial<Record<keyof Values | 'location' | 'form', string>>;

const empty = (): Values => ({
  season: seasonOptions()[0]!,
  name: '',
  size_value: '',
  size_unit: '',
  tenure: '',
  village: '',
  location_note: '',
  crops: [],
  notes: '',
});

/**
 * RECORD A FARM BY HAND (2026-10-10). The owner: "forget the GIS mapping for
 * now and add a form the extension officer can use to manually record the farm
 * information; GIS mapping should still be there but will be added as we go
 * along." The officer writes down what the farmer says: the size in the
 * farmer's unit, how the land is held, where it is, the season's crops. The
 * phone's position can be taken standing at the farm. Nothing here is a
 * boundary; the farm is mapped later and only then has a measured area.
 *
 * Officer only, and only for a farmer in their caseload: the route refuses
 * anyone else. Validated with the same schema the route uses.
 */
export function RecordFarm() {
  const farmerId = useSearchParams().get('farmer') ?? '';
  const { role, hydrated } = usePreview();
  const [farmer, setFarmer] = useState<Farmer | null | undefined>(undefined);
  const [values, setValues] = useState<Values>(empty);
  const [point, setPoint] = useState<Point | null>(null);
  const [locating, setLocating] = useState(false);
  const [errors, setErrors] = useState<Errors>({});
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState<{ name: string; pending?: boolean } | null>(null);
  /** PWA: who the farmer is when only this phone knows (no signal, or still waiting to send). */
  const [onPhone, setOnPhone] = useState<{ name: string; waiting: boolean } | null>(null);

  useEffect(() => {
    let on = true;
    getFarmer(farmerId)
      .then((f) => on && setFarmer(f))
      .catch(async (e: unknown) => {
        // PWA (2026-10-10): with no signal, or for a farmer registered on this
        // phone and not sent yet, the phone's own copy says who it is.
        const kept = isNoSignal(e) || offlineNow() ? await farmerOnPhone(farmerId) : null;
        if (!on) return;
        if (kept) {
          setOnPhone({ name: kept.name, waiting: kept.waiting });
          setFarmer(kept.farmer ?? undefined);
          return;
        }
        // A farmer registered on this phone is unknown to the server until it
        // is sent: a 404 then is "not yet", not "not yours".
        const waiting = await farmerOnPhone(farmerId);
        if (!on) return;
        if (waiting?.waiting) {
          setOnPhone({ name: waiting.name, waiting: true });
          return;
        }
        setFarmer(null);
      });
    return () => {
      on = false;
    };
  }, [farmerId]);

  const set = <K extends keyof Values>(key: K, value: Values[K]) =>
    setValues((v) => ({ ...v, [key]: value }));

  const toggleCrop = (crop: Crop) =>
    setValues((v) => ({
      ...v,
      crops: v.crops.includes(crop) ? v.crops.filter((c) => c !== crop) : [...v.crops, crop],
    }));

  function takePosition() {
    if (typeof navigator === 'undefined' || !navigator.geolocation) {
      setErrors((e) => ({ ...e, location: 'This phone cannot give its position.' }));
      return;
    }
    setLocating(true);
    setErrors((e) => ({ ...e, location: undefined }));
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setPoint({
          latitude: pos.coords.latitude,
          longitude: pos.coords.longitude,
          accuracy_m: Math.round(pos.coords.accuracy * 10) / 10,
        });
        setLocating(false);
      },
      (err) => {
        setErrors((e) => ({
          ...e,
          location:
            err.code === err.PERMISSION_DENIED
              ? 'Location is blocked for this site. Allow it in the browser settings, or leave it out.'
              : 'Could not get a position. Try again in the open, or leave it out.',
        }));
        setLocating(false);
      },
      { enableHighAccuracy: true, timeout: 30_000, maximumAge: 0 },
    );
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const body: RecordFarmInput = {
      id: crypto.randomUUID(),
      season: values.season,
      name: values.name,
      size_value: values.size_value.trim() === '' ? null : Number(values.size_value),
      size_unit:
        values.size_unit === '' ? null : (values.size_unit as RecordFarmInput['size_unit']),
      tenure: values.tenure === '' ? null : (values.tenure as RecordFarmInput['tenure']),
      village: values.village,
      location_note: values.location_note,
      location: point,
      crops: values.crops,
      notes: values.notes,
      captured_at: new Date().toISOString(),
    };
    const parsed = recordFarmSchema.safeParse(body);
    if (!parsed.success) {
      const next: Errors = {};
      for (const issue of parsed.error.issues) {
        const key = String(issue.path[0] ?? 'form') as keyof Errors;
        next[key] ??= issue.message;
      }
      setErrors(next);
      return;
    }
    setErrors({});
    setBusy(true);
    // PWA (2026-10-10): with no signal, or if it drops mid-send, the farm is
    // saved on this phone and sent later (after the farmer, if they are still
    // waiting to send). The same id sent twice is the same farm (C-9.2).
    const keepOnPhone = async () => {
      await queueFarm(farmerId, who, body);
      setSaved({ name: values.name.trim() || 'The farm', pending: true });
    };
    try {
      if (offlineNow() || onPhone?.waiting) {
        await keepOnPhone();
        return;
      }
      await recordFarm(farmerId, body);
      setSaved({ name: values.name.trim() || 'The farm' });
    } catch (err) {
      if (isNoSignal(err)) {
        await keepOnPhone();
        return;
      }
      setErrors({
        form:
          err instanceof FarmApiError
            ? err.message
            : 'Could not record the farm. Please try again.',
      });
    } finally {
      setBusy(false);
    }
  }

  const back = `/farmers/${encodeURIComponent(farmerId)}`;
  const who = farmer
    ? `${farmer.given_name} ${farmer.family_name}`
    : (onPhone?.name ?? 'the farmer');

  if (hydrated && role !== 'officer') {
    return (
      <>
        <PageHeader eyebrow="Farms" title="Record a farm" />
        <Notice kind="info" title="Officers record farms">
          <p className="small">A farm is recorded by the extension officer who works the farmer.</p>
        </Notice>
      </>
    );
  }

  if (saved) {
    return (
      <>
        <PageHeader eyebrow="Farms" title="Record a farm" />
        <div className={styles.recorded}>
          <p className="label">{saved.pending ? 'Saved on this phone' : 'Recorded'}</p>
          <p>
            {saved.pending
              ? `${saved.name} for ${who} is saved on this phone and will be sent automatically when there is signal.`
              : `${saved.name} was recorded for ${who}. It is not mapped yet; the size shown is what the farmer declared.`}
          </p>
          <div className={screens.formActions}>
            <Button
              variant="primary"
              onClick={() => {
                setSaved(null);
                setValues(empty());
                setPoint(null);
              }}
            >
              Record another farm
            </Button>
            <ButtonLink href={back} variant="secondary">
              Back to {who}
            </ButtonLink>
          </div>
        </div>
      </>
    );
  }

  return (
    <>
      <PageHeader
        eyebrow="Farms"
        title="Record a farm"
        subtitle={`For ${who}. Write down what the farmer tells you; the farm can be mapped with GPS later.`}
        actions={
          <ButtonLink href={back} variant="secondary">
            Cancel
          </ButtonLink>
        }
      />

      {onPhone?.waiting ? (
        <Notice kind="info" title="This farmer is waiting to send">
          <p className="small">
            {onPhone.name} was registered on this phone and has not reached the server yet. The farm
            is saved on this phone and sent right after the farmer.
          </p>
        </Notice>
      ) : null}

      {farmer === null ? (
        <Notice kind="error" title="Farmer not found">
          <p className="small">This farmer is not in your caseload, or could not be loaded.</p>
        </Notice>
      ) : null}

      {errors.form ? (
        <div className={styles.errorSummary} role="alert">
          <p className="label">The farm was not recorded</p>
          <p>{errors.form}</p>
        </div>
      ) : null}

      <form onSubmit={submit} noValidate>
        <div className={styles.homeStack}>
          <Card as="section" className={screens.formSection}>
            <h2 className={screens.formSectionTitle}>The farm</h2>
            <div className={screens.formGrid}>
              <Field
                label="Farm name"
                optional
                hint="What the farmer calls it."
                error={errors.name}
              >
                {(ids) => (
                  <Input
                    {...ids}
                    dir="auto"
                    maxLength={120}
                    value={values.name}
                    onChange={(e) => set('name', e.target.value)}
                  />
                )}
              </Field>
              <Field label="Season" error={errors.season}>
                {(ids) => (
                  <Select
                    {...ids}
                    value={values.season}
                    onChange={(e) => set('season', e.target.value)}
                  >
                    {seasonOptions().map((s) => (
                      <option key={s} value={s}>
                        {seasonLabel(s)}
                      </option>
                    ))}
                  </Select>
                )}
              </Field>
              <Field
                label="Size"
                optional
                hint="As the farmer gives it. Not a measurement."
                error={errors.size_value}
              >
                {(ids) => (
                  <Input
                    {...ids}
                    inputMode="decimal"
                    value={values.size_value}
                    onChange={(e) => set('size_value', e.target.value.replace(/[^0-9.]/g, ''))}
                  />
                )}
              </Field>
              <Field label="Unit" optional error={errors.size_unit}>
                {(ids) => (
                  <Select
                    {...ids}
                    value={values.size_unit}
                    onChange={(e) => set('size_unit', e.target.value)}
                  >
                    <option value="">Select…</option>
                    {LAND_UNITS.map((u) => (
                      <option key={u} value={u}>
                        {UNIT_LABELS[u]}
                      </option>
                    ))}
                  </Select>
                )}
              </Field>
              <Field label="How the land is held" optional error={errors.tenure}>
                {(ids) => (
                  <Select
                    {...ids}
                    value={values.tenure}
                    onChange={(e) => set('tenure', e.target.value)}
                  >
                    <option value="">Select…</option>
                    {LAND_TENURES.map((t) => (
                      <option key={t} value={t}>
                        {TENURE_LABELS[t]}
                      </option>
                    ))}
                  </Select>
                )}
              </Field>
            </div>
          </Card>

          <Card as="section" className={screens.formSection}>
            <h2 className={screens.formSectionTitle}>Where it is</h2>
            <div className={screens.formGrid}>
              <Field label="Village" optional error={errors.village}>
                {(ids) => (
                  <Input
                    {...ids}
                    dir="auto"
                    maxLength={120}
                    value={values.village}
                    onChange={(e) => set('village', e.target.value)}
                  />
                )}
              </Field>
              <div className={screens.span2}>
                <Field
                  label="Directions or landmark"
                  optional
                  hint="How someone would find the farm."
                  error={errors.location_note}
                >
                  {(ids) => (
                    <Textarea
                      {...ids}
                      rows={2}
                      dir="auto"
                      maxLength={500}
                      value={values.location_note}
                      onChange={(e) => set('location_note', e.target.value)}
                    />
                  )}
                </Field>
              </div>
              <div className={screens.span2}>
                <Field
                  label="Position"
                  optional
                  hint="Stand at the farm and take the phone's position. This is one point, not a boundary."
                  error={errors.location}
                >
                  {() => (
                    <div className={screens.formActions}>
                      {point ? (
                        <span className="mono small">
                          {point.latitude.toFixed(5)}, {point.longitude.toFixed(5)} · ±
                          {point.accuracy_m} m
                        </span>
                      ) : (
                        <span className="small muted">Not taken</span>
                      )}
                      <span>
                        <Button
                          type="button"
                          variant="secondary"
                          onClick={takePosition}
                          disabled={locating}
                        >
                          {locating ? 'Getting position…' : point ? 'Take again' : 'Take position'}
                        </Button>{' '}
                        {point ? (
                          <Button type="button" variant="ghost" onClick={() => setPoint(null)}>
                            Clear
                          </Button>
                        ) : null}
                      </span>
                    </div>
                  )}
                </Field>
              </div>
            </div>
          </Card>

          <Card as="section" className={screens.formSection}>
            <h2 className={screens.formSectionTitle}>Crops and notes</h2>
            <Field
              label="Crops this season"
              optional
              hint="Tick every crop grown on this farm."
              error={errors.crops}
            >
              {() => (
                <div className={screens.formActions}>
                  {CROPS.map((crop) => (
                    <Checkbox
                      key={crop}
                      label={CROP_LABELS[crop]}
                      checked={values.crops.includes(crop)}
                      onChange={() => toggleCrop(crop)}
                    />
                  ))}
                </div>
              )}
            </Field>
            <Field label="Notes" optional error={errors.notes}>
              {(ids) => (
                <Textarea
                  {...ids}
                  rows={3}
                  dir="auto"
                  maxLength={2000}
                  value={values.notes}
                  onChange={(e) => set('notes', e.target.value)}
                />
              )}
            </Field>
          </Card>

          <div className={screens.formActions}>
            <Button type="submit" variant="primary" disabled={busy || farmer === null}>
              {busy ? 'Recording…' : 'Record farm'}
            </Button>
          </div>
        </div>
      </form>
    </>
  );
}
