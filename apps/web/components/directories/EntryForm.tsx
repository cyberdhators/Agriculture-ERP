'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useMemo, useState, type FormEvent } from 'react';

import {
  DIRECTORY_ENTRY_TYPES,
  DIRECTORY_LIMITS,
  FINANCIAL_PROVIDER_CLASSES,
  directoryEntryInputSchema,
  todayIso,
  type DirectoryEntryInput,
} from '@agri-erp/shared';

import { PAYAMS, type DirectoryEntryRow } from '@/lib/fixtures/p1';
import { ENTRY_TYPE_LABELS, PROVIDER_CLASS_LABELS } from '@/lib/format';
import { LIVE_DIRECTORIES } from '@/lib/directories/api';
import { newId, usePreview } from '@/lib/preview';
import { issuesByField } from '@/lib/zod-errors';

import {
  Button,
  ButtonLink,
  Card,
  Checkbox,
  Field,
  Input,
  Notice,
  PageHeader,
  PrefixedInput,
  Select,
  Textarea,
} from '../ui';
import { IconCheck } from '../ui/icons';
import styles from '../screens.module.css';

/**
 * Create or edit a directory entry. Administrators only.
 *
 * Validation runs the shared Zod schema, directoryEntryInputSchema, on every
 * submit, so each error message is the exact sentence the API returns for the
 * same input (CLAUDE.md, Validation). The provider class field appears only
 * for a financial service, mirroring the database CHECK constraint.
 *
 * Preview: "Save" validates, shows the JSON body the route would receive,
 * and writes to the in-memory store. Nothing leaves the browser.
 */

interface FormState {
  entry_type: string;
  name: string;
  provider_class: string;
  description: string;
  services: string;
  contact_name: string;
  phone: string;
  alt_phone: string;
  email: string;
  physical_address: string;
  payam_id: string;
  latitude: string;
  longitude: string;
  last_verified_at: string;
  active: boolean;
}

const STRIP_PREFIX = /^\+?211/;

function fromRow(row: DirectoryEntryRow | null): FormState {
  return {
    entry_type: row?.entry_type ?? 'agro_dealer',
    name: row?.name ?? '',
    provider_class: row?.provider_class ?? '',
    description: row?.description ?? '',
    services: row?.services.join(', ') ?? '',
    contact_name: row?.contact_name ?? '',
    phone: row ? row.phone.replace(STRIP_PREFIX, '') : '',
    alt_phone: row?.alt_phone ? row.alt_phone.replace(STRIP_PREFIX, '') : '',
    email: row?.email ?? '',
    physical_address: row?.physical_address ?? '',
    payam_id: row?.payam_id ?? '',
    latitude: row?.location ? String(row.location.latitude) : '',
    longitude: row?.location ? String(row.location.longitude) : '',
    last_verified_at: row?.last_verified_at ?? todayIso(),
    active: row?.active ?? true,
  };
}

/** Form strings -> the request body shape. Unknown until the schema says so. */
function toBody(form: FormState): unknown {
  const phone = form.phone.trim() === '' ? '' : `+211${form.phone.trim()}`;
  const altPhone = form.alt_phone.trim() === '' ? null : `+211${form.alt_phone.trim()}`;
  const hasLat = form.latitude.trim() !== '';
  const hasLng = form.longitude.trim() !== '';
  return {
    entry_type: form.entry_type,
    name: form.name,
    description: form.description,
    services: form.services
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean),
    contact_name: form.contact_name,
    phone,
    alt_phone: altPhone,
    email: form.email,
    physical_address: form.physical_address,
    location:
      hasLat || hasLng
        ? { latitude: Number(form.latitude), longitude: Number(form.longitude) }
        : null,
    payam_id: form.payam_id,
    state_id: PAYAMS.find((p) => p.id === form.payam_id)?.stateId ?? '',
    provider_class: form.provider_class === '' ? null : form.provider_class,
    last_verified_at: form.last_verified_at,
    active: form.active,
  };
}

export function EntryForm({ existing }: { existing: DirectoryEntryRow | null }) {
  const router = useRouter();
  const { saveEntry } = usePreview();
  const [form, setForm] = useState<FormState>(() => fromRow(existing));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saved, setSaved] = useState<DirectoryEntryInput | null>(null);
  const [serverError, setServerError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [attempted, setAttempted] = useState(false);

  const schema = useMemo(() => directoryEntryInputSchema(), []);
  const isFinancial = form.entry_type === 'financial_service';

  function update<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((f) => ({ ...f, [key]: value }));
    if (attempted) {
      // Re-validate live once the user has tried to submit, so an error clears
      // the moment it is fixed rather than on the next submit.
      const result = schema.safeParse(toBody({ ...form, [key]: value }));
      setErrors(result.success ? {} : issuesByField(result.error.issues));
    }
  }

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setAttempted(true);
    setSaved(null);
    setServerError(null);

    const body = toBody(form);
    const result = schema.safeParse(body);
    if (!result.success) {
      const fieldErrors = issuesByField(result.error.issues);
      // A half-filled GPS point fails as a plain type error inside Zod; say it in words.
      if (
        (form.latitude.trim() === '') !== (form.longitude.trim() === '') &&
        !fieldErrors['location']
      ) {
        fieldErrors['location'] = 'Enter both latitude and longitude, or leave both empty.';
      }
      setErrors(fieldErrors);
      const first = document.querySelector<HTMLElement>('[aria-invalid="true"]');
      first?.focus();
      return;
    }

    setErrors({});
    const value = result.data;
    const now = new Date().toISOString();
    const row: DirectoryEntryRow = {
      id: existing?.id ?? newId(),
      entry_type: value.entry_type,
      name: value.name,
      description: value.description ?? null,
      services: value.services,
      contact_name: value.contact_name ?? null,
      phone: value.phone,
      alt_phone: value.alt_phone ?? null,
      email: value.email ?? null,
      physical_address: value.physical_address ?? null,
      location: value.location ?? null,
      payam_id: value.payam_id,
      state_id: value.state_id,
      provider_class: value.provider_class ?? null,
      last_verified_at: value.last_verified_at,
      verified_by: existing?.verified_by ?? null,
      active: value.active,
      created_at: existing?.created_at ?? now,
      updated_at: now,
      deleted_at: null,
    };
    setBusy(true);
    try {
      await saveEntry(row);
    } catch (e) {
      setServerError(e instanceof Error ? e.message : 'The entry could not be saved.');
      window.scrollTo({ top: 0 });
      return;
    } finally {
      setBusy(false);
    }
    setSaved(value);
    window.scrollTo({ top: 0 });
  }

  const title = existing ? 'Edit entry' : 'Add directory entry';

  return (
    <>
      <PageHeader
        eyebrow="Directories"
        title={title}
        subtitle={
          existing
            ? `Editing “${existing.name}”. Every saved change is recorded with who made it and when.`
            : 'A named place with a phone number that a farmer can be sent to. Not an account, not a balance.'
        }
        actions={
          <ButtonLink
            href={existing ? `/directories?entry=${existing.id}` : '/directories'}
            variant="ghost"
          >
            Back to directories
          </ButtonLink>
        }
      />

      {saved ? (
        <Notice
          kind="success"
          title={LIVE_DIRECTORIES ? 'Saved' : 'Saved (preview)'}
          className="no-print"
        >
          {LIVE_DIRECTORIES
            ? `Recorded with who made the change and when. Officers ${existing ? 'get the change' : 'see it'} on their next sync. `
            : `Validated with the shared schema and written to this session’s preview store only. In the live portal this is a ${existing ? 'PATCH' : 'POST'} to /api/directory-entries. `}
          <Link href={`/directories?entry=${existing?.id ?? ''}`}>View the entry</Link>.
        </Notice>
      ) : null}

      {serverError ? (
        <Notice kind="error" title="The entry was not saved">
          {serverError}
        </Notice>
      ) : null}

      {attempted && Object.keys(errors).length > 0 ? (
        <Notice kind="error" title="The entry cannot be saved yet">
          Fix the {Object.keys(errors).length === 1 ? 'field' : 'fields'} marked below. Nothing has
          been saved.
        </Notice>
      ) : null}

      <div className={styles.formLayout} style={{ marginTop: 'var(--s-5)' }}>
        <form onSubmit={onSubmit} noValidate>
          <Card as="div">
            <section className={styles.formSection} aria-labelledby="sec-identity">
              <div className={styles.formSectionTitle}>
                <h2 id="sec-identity">What it is</h2>
                <p className="small muted">
                  The directory this entry belongs to and how it is named.
                </p>
              </div>
              <div className={styles.formGrid}>
                <Field label="Directory" error={errors['entry_type']}>
                  {(ids) => (
                    <Select
                      {...ids}
                      value={form.entry_type}
                      onChange={(event) => {
                        update('entry_type', event.target.value);
                        if (event.target.value !== 'financial_service')
                          update('provider_class', '');
                      }}
                    >
                      {DIRECTORY_ENTRY_TYPES.map((t) => (
                        <option key={t} value={t}>
                          {ENTRY_TYPE_LABELS[t]}
                        </option>
                      ))}
                    </Select>
                  )}
                </Field>
                {isFinancial ? (
                  <Field label="Kind of financial service" error={errors['provider_class']}>
                    {(ids) => (
                      <Select
                        {...ids}
                        value={form.provider_class}
                        onChange={(event) => update('provider_class', event.target.value)}
                      >
                        <option value="">Choose…</option>
                        {FINANCIAL_PROVIDER_CLASSES.map((c) => (
                          <option key={c} value={c}>
                            {PROVIDER_CLASS_LABELS[c]}
                          </option>
                        ))}
                      </Select>
                    )}
                  </Field>
                ) : (
                  <div aria-hidden />
                )}
                <div className={styles.span2}>
                  <Field
                    label="Name"
                    error={errors['name']}
                    hint={`As a farmer would know it. Up to ${DIRECTORY_LIMITS.nameMax} characters.`}
                  >
                    {(ids) => (
                      <Input
                        {...ids}
                        value={form.name}
                        onChange={(event) => update('name', event.target.value)}
                        dir="auto"
                        autoComplete="organization"
                      />
                    )}
                  </Field>
                </div>
                <div className={styles.span2}>
                  <Field
                    label="Services"
                    optional
                    error={errors['services']}
                    hint={`Separate with commas: seeds, fertiliser, hand tools. Up to ${DIRECTORY_LIMITS.servicesMax}, each listed once.`}
                  >
                    {(ids) => (
                      <Input
                        {...ids}
                        value={form.services}
                        onChange={(event) => update('services', event.target.value)}
                        dir="auto"
                      />
                    )}
                  </Field>
                </div>
                <div className={styles.span2}>
                  <Field label="Description" optional error={errors['description']}>
                    {(ids) => (
                      <Textarea
                        {...ids}
                        value={form.description}
                        onChange={(event) => update('description', event.target.value)}
                        dir="auto"
                      />
                    )}
                  </Field>
                </div>
              </div>
            </section>

            <section className={styles.formSection} aria-labelledby="sec-contact">
              <div className={styles.formSectionTitle}>
                <h2 id="sec-contact">How to reach it</h2>
                <p className="small muted">South Sudan numbers only: +211 then nine digits.</p>
              </div>
              <div className={styles.formGrid}>
                <Field label="Phone" error={errors['phone']}>
                  {(ids) => (
                    <PrefixedInput
                      {...ids}
                      prefix="+211"
                      inputMode="tel"
                      autoComplete="tel-national"
                      placeholder="92 884 1107"
                      value={form.phone}
                      onChange={(event) => update('phone', event.target.value)}
                    />
                  )}
                </Field>
                <Field label="Other phone" optional error={errors['alt_phone']}>
                  {(ids) => (
                    <PrefixedInput
                      {...ids}
                      prefix="+211"
                      inputMode="tel"
                      value={form.alt_phone}
                      onChange={(event) => update('alt_phone', event.target.value)}
                    />
                  )}
                </Field>
                <Field label="Contact person" optional error={errors['contact_name']}>
                  {(ids) => (
                    <Input
                      {...ids}
                      value={form.contact_name}
                      onChange={(event) => update('contact_name', event.target.value)}
                      dir="auto"
                      autoComplete="name"
                    />
                  )}
                </Field>
                <Field label="Email" optional error={errors['email']}>
                  {(ids) => (
                    <Input
                      {...ids}
                      type="email"
                      inputMode="email"
                      autoComplete="email"
                      value={form.email}
                      onChange={(event) => update('email', event.target.value)}
                    />
                  )}
                </Field>
              </div>
            </section>

            <section className={styles.formSection} aria-labelledby="sec-where">
              <div className={styles.formSectionTitle}>
                <h2 id="sec-where">Where it is</h2>
                <p className="small muted">
                  Payam is required. A GPS point is optional and lets the map show it.
                </p>
              </div>
              <div className={styles.formGrid}>
                <Field label="Payam" error={errors['payam_id'] ?? errors['state_id']}>
                  {(ids) => (
                    <Select
                      {...ids}
                      value={form.payam_id}
                      onChange={(event) => update('payam_id', event.target.value)}
                    >
                      <option value="">Choose a payam…</option>
                      {PAYAMS.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.name} Payam, Juba County
                        </option>
                      ))}
                    </Select>
                  )}
                </Field>
                <Field label="Address" optional error={errors['physical_address']}>
                  {(ids) => (
                    <Input
                      {...ids}
                      value={form.physical_address}
                      onChange={(event) => update('physical_address', event.target.value)}
                      dir="auto"
                      autoComplete="street-address"
                    />
                  )}
                </Field>
                <Field
                  label="Latitude"
                  optional
                  error={errors['location']}
                  hint="Decimal degrees, e.g. 4.8517"
                >
                  {(ids) => (
                    <Input
                      {...ids}
                      inputMode="decimal"
                      value={form.latitude}
                      onChange={(event) => update('latitude', event.target.value)}
                    />
                  )}
                </Field>
                <Field label="Longitude" optional hint="Decimal degrees, e.g. 31.6018">
                  {(ids) => (
                    <Input
                      {...ids}
                      inputMode="decimal"
                      aria-invalid={errors['location'] ? true : undefined}
                      value={form.longitude}
                      onChange={(event) => update('longitude', event.target.value)}
                    />
                  )}
                </Field>
              </div>
            </section>

            <section className={styles.formSection} aria-labelledby="sec-check">
              <div className={styles.formSectionTitle}>
                <h2 id="sec-check">Checked</h2>
                <p className="small muted">
                  When someone last confirmed this entry is open and the number works. It is shown
                  to every officer.
                </p>
              </div>
              <div className={styles.formGrid}>
                <Field label="Date last checked" error={errors['last_verified_at']}>
                  {(ids) => (
                    <Input
                      {...ids}
                      type="date"
                      max={todayIso()}
                      value={form.last_verified_at}
                      onChange={(event) => update('last_verified_at', event.target.value)}
                    />
                  )}
                </Field>
                {existing ? (
                  <Checkbox
                    label="Active, shown to officers"
                    checked={form.active}
                    onChange={(event) => update('active', event.target.checked)}
                  />
                ) : null}
              </div>
            </section>

            <div className={`${styles.formSection} ${styles.formActions}`}>
              <Button type="submit" disabled={busy}>
                <IconCheck size={18} />
                {busy ? 'Saving…' : existing ? 'Save changes' : 'Save entry'}
              </Button>
              <Button variant="ghost" onClick={() => router.back()}>
                Cancel
              </Button>
              <span className="small muted">Saving records who and when. Nothing is deleted.</span>
            </div>
          </Card>
        </form>

        <aside className={styles.aside} aria-label="Preview of the request">
          <Card padded as="div">
            <h3>What will be sent</h3>
            <p className="small muted" style={{ margin: 'var(--s-2) 0 var(--s-4)' }}>
              The body of the request, after the shared schema has trimmed and normalised it. Shown
              here so the form and the API can be seen to agree.
            </p>
            {saved ? (
              <pre className={styles.previewJson}>{JSON.stringify(saved, null, 2)}</pre>
            ) : (
              <p className="small muted">Save the form to see the validated body.</p>
            )}
          </Card>
          <Card padded as="div">
            <h3>Rules</h3>
            <ul
              className="small"
              style={{
                display: 'grid',
                gap: 6,
                marginTop: 'var(--s-3)',
                paddingLeft: 18,
                listStyle: 'disc',
                color: 'var(--ink-2)',
              }}
            >
              <li>Only a financial service has a kind (bank, microfinance, mobile money…).</li>
              <li>Phone numbers are stored as +211 and nine digits; spaces are removed.</li>
              <li>The date last checked cannot be in the future.</li>
              <li>Removing an entry makes it inactive; it is never deleted.</li>
            </ul>
          </Card>
        </aside>
      </div>
    </>
  );
}
