'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useRef, useState, type ChangeEvent, type FormEvent } from 'react';

import {
  CROPS,
  LANGUAGES,
  LEARNING_LIMITS,
  LEARNING_TOPICS,
  RESOURCE_FORMATS,
  learningResourceInputSchema,
  type LearningResourceInput,
  type ResourceFormat,
} from '@agri-erp/shared';

import type { LearningResourceRow } from '@/lib/fixtures/p1';
import {
  CROP_LABELS,
  FORMAT_LABELS,
  LANGUAGE_LABELS,
  TOPIC_LABELS,
  formatBytes,
} from '@/lib/format';
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
  Select,
  Textarea,
} from '../ui';
import { IconCheck, IconUpload } from '../ui/icons';
import styles from '../screens.module.css';
import { FormatIcon } from './resource-presentation';

/**
 * Add or edit a learning resource. Administrators only.
 *
 * The file goes to Supabase Storage; the form only records where it landed
 * (storage_path) and how big it is (byte_size). In this preview "Choose file"
 * reads the name and size of a local file to fill those two fields, and
 * uploads nothing. The catalogue card is validated with the shared
 * learningResourceInputSchema, so every message is the API's own.
 */

interface FormState {
  title: string;
  topic: string;
  crop: string;
  language: string;
  format: string;
  storage_path: string;
  byte_size: string;
  description: string;
  published: boolean;
}

function fromRow(row: LearningResourceRow | null): FormState {
  return {
    title: row?.title ?? '',
    topic: row?.topic ?? 'crop_production',
    crop: row?.crop ?? '',
    language: row?.language ?? 'en',
    format: row?.format ?? 'pdf',
    storage_path: row?.storage_path ?? '',
    byte_size: row ? String(row.byte_size) : '',
    description: row?.description ?? '',
    published: row?.published ?? false,
  };
}

function toBody(form: FormState): unknown {
  return {
    title: form.title,
    topic: form.topic,
    crop: form.crop === '' ? null : form.crop,
    language: form.language,
    format: form.format,
    storage_path: form.storage_path,
    byte_size: form.byte_size.trim() === '' ? undefined : Number(form.byte_size),
    description: form.description,
    published: form.published,
  };
}

/** Guess the format from a file's MIME type so the admin rarely has to pick it. */
function formatFromMime(mime: string): ResourceFormat | null {
  if (mime === 'application/pdf') return 'pdf';
  if (mime.startsWith('image/')) return 'image';
  if (mime.startsWith('audio/')) return 'audio';
  if (mime.startsWith('video/')) return 'video';
  return null;
}

/** File name -> a safe path segment the storage_path schema accepts. */
function safeSegment(name: string): string {
  return (
    name
      .normalize('NFKD')
      .replace(/[^\w.-]+/g, '-')
      .replace(/^[-.]+|[-.]+$/g, '')
      .toLowerCase() || 'file'
  );
}

export function ResourceForm({ existing }: { existing: LearningResourceRow | null }) {
  const router = useRouter();
  const { saveResource } = usePreview();
  const [form, setForm] = useState<FormState>(() => fromRow(existing));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saved, setSaved] = useState<LearningResourceInput | null>(null);
  const [attempted, setAttempted] = useState(false);
  const [fileName, setFileName] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  function update<K extends keyof FormState>(key: K, value: FormState[K]) {
    const next = { ...form, [key]: value };
    setForm(next);
    if (attempted) {
      const result = learningResourceInputSchema.safeParse(toBody(next));
      setErrors(result.success ? {} : issuesByField(result.error.issues));
    }
  }

  function onFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    const year = new Date().getUTCFullYear();
    const guessed = formatFromMime(file.type);
    setFileName(file.name);
    setForm((f) => ({
      ...f,
      storage_path: `${guessed ?? f.format}/${year}/${safeSegment(file.name)}`,
      byte_size: String(file.size),
      format: guessed ?? f.format,
      title: f.title || file.name.replace(/\.[^.]+$/, ''),
    }));
  }

  function onSubmit(event: FormEvent) {
    event.preventDefault();
    setAttempted(true);
    setSaved(null);
    const result = learningResourceInputSchema.safeParse(toBody(form));
    if (!result.success) {
      setErrors(issuesByField(result.error.issues));
      document.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus();
      return;
    }
    setErrors({});
    const value = result.data;
    const row: LearningResourceRow = {
      id: existing?.id ?? newId(),
      title: value.title,
      topic: value.topic,
      crop: value.crop ?? null,
      language: value.language,
      format: value.format,
      storage_path: value.storage_path,
      byte_size: value.byte_size,
      description: value.description ?? null,
      published: value.published,
      uploaded_by: existing?.uploaded_by ?? null,
      uploaded_at: existing?.uploaded_at ?? new Date().toISOString(),
      deleted_at: null,
    };
    saveResource(row);
    setSaved(value);
    window.scrollTo({ top: 0 });
  }

  const byteSize = Number(form.byte_size);
  const currentFormat = (RESOURCE_FORMATS as readonly string[]).includes(form.format)
    ? (form.format as ResourceFormat)
    : 'pdf';

  return (
    <>
      <PageHeader
        eyebrow="Learning library"
        title={existing ? 'Edit resource' : 'Add learning resource'}
        subtitle={
          existing
            ? `Editing “${existing.title}”. Replace the file or change the card; officers get the new version on their next sync.`
            : 'Upload a file and describe it well enough that an officer in the field knows whether it is worth the download.'
        }
        actions={
          <ButtonLink
            href={existing ? `/library?resource=${existing.id}` : '/library'}
            variant="ghost"
          >
            Back to library
          </ButtonLink>
        }
      />

      {saved ? (
        <Notice kind="success" title="Saved (preview)" className="no-print">
          Validated with the shared schema and written to this session’s preview store only. In the
          live portal this is a {existing ? 'PATCH' : 'POST'} to /api/learning-resources.{' '}
          <Link
            href={`/library?resource=${existing?.id ?? ''}${saved.published ? '' : '&drafts=1'}`}
          >
            View the resource
          </Link>
          .
        </Notice>
      ) : null}

      {attempted && Object.keys(errors).length > 0 ? (
        <Notice kind="error" title="The resource cannot be saved yet">
          Fix the {Object.keys(errors).length === 1 ? 'field' : 'fields'} marked below. Nothing has
          been saved.
        </Notice>
      ) : null}

      <div className={styles.formLayout} style={{ marginTop: 'var(--s-5)' }}>
        <form onSubmit={onSubmit} noValidate>
          <Card as="div">
            <section className={styles.formSection} aria-labelledby="sec-file">
              <div className={styles.formSectionTitle}>
                <h2 id="sec-file">The file</h2>
                <p className="small muted">
                  PDF, image, audio or video, up to {formatBytes(LEARNING_LIMITS.byteSizeMax)}.
                </p>
              </div>

              <div className={styles.uploadStub}>
                <div className={styles.uploadStubRow}>
                  <span className={styles.formatTile}>
                    <FormatIcon format={currentFormat} />
                  </span>
                  <div style={{ display: 'grid', gap: 2, flex: 1, minWidth: 0 }}>
                    <span style={{ fontWeight: 700 }} dir="auto">
                      {fileName ??
                        (existing ? existing.storage_path.split('/').pop() : 'No file chosen')}
                    </span>
                    <span className="small muted">
                      {form.byte_size
                        ? formatBytes(byteSize)
                        : 'Choose a file to fill in the path and size'}
                    </span>
                  </div>
                  <input
                    ref={fileInput}
                    type="file"
                    className="visually-hidden"
                    accept="application/pdf,image/*,audio/*,video/*"
                    onChange={onFile}
                    aria-label="Choose file"
                  />
                  <Button variant="secondary" onClick={() => fileInput.current?.click()}>
                    <IconUpload size={18} />
                    Choose file
                  </Button>
                </div>
                <p className="small muted">
                  Preview: the file is read for its name and size only and is not uploaded. The live
                  portal uploads to Supabase Storage first and then saves this card.
                </p>
              </div>

              <div className={styles.formGrid}>
                <Field
                  label="Storage path"
                  error={errors['storage_path']}
                  hint="Filled in by the upload. Relative to the bucket."
                >
                  {(ids) => (
                    <Input
                      {...ids}
                      value={form.storage_path}
                      onChange={(event) => update('storage_path', event.target.value)}
                      spellCheck={false}
                    />
                  )}
                </Field>
                <Field
                  label="Size in bytes"
                  error={errors['byte_size']}
                  hint={form.byte_size ? formatBytes(byteSize) : undefined}
                >
                  {(ids) => (
                    <Input
                      {...ids}
                      inputMode="numeric"
                      value={form.byte_size}
                      onChange={(event) => update('byte_size', event.target.value)}
                    />
                  )}
                </Field>
                <Field label="Format" error={errors['format']}>
                  {(ids) => (
                    <Select
                      {...ids}
                      value={form.format}
                      onChange={(event) => update('format', event.target.value)}
                    >
                      {RESOURCE_FORMATS.map((f) => (
                        <option key={f} value={f}>
                          {FORMAT_LABELS[f]}
                        </option>
                      ))}
                    </Select>
                  )}
                </Field>
                <Field label="Language" error={errors['language']}>
                  {(ids) => (
                    <Select
                      {...ids}
                      value={form.language}
                      onChange={(event) => update('language', event.target.value)}
                    >
                      {LANGUAGES.map((l) => (
                        <option key={l} value={l}>
                          {LANGUAGE_LABELS[l]}
                        </option>
                      ))}
                    </Select>
                  )}
                </Field>
              </div>
            </section>

            <section className={styles.formSection} aria-labelledby="sec-card">
              <div className={styles.formSectionTitle}>
                <h2 id="sec-card">The card</h2>
                <p className="small muted">What an officer reads before deciding to download.</p>
              </div>
              <div className={styles.formGrid}>
                <div className={styles.span2}>
                  <Field
                    label="Title"
                    error={errors['title']}
                    hint={`Up to ${LEARNING_LIMITS.titleMax} characters, in the language of the resource.`}
                  >
                    {(ids) => (
                      <Input
                        {...ids}
                        value={form.title}
                        onChange={(event) => update('title', event.target.value)}
                        dir="auto"
                      />
                    )}
                  </Field>
                </div>
                <Field label="Topic" error={errors['topic']}>
                  {(ids) => (
                    <Select
                      {...ids}
                      value={form.topic}
                      onChange={(event) => update('topic', event.target.value)}
                    >
                      {LEARNING_TOPICS.map((t) => (
                        <option key={t} value={t}>
                          {TOPIC_LABELS[t]}
                        </option>
                      ))}
                    </Select>
                  )}
                </Field>
                <Field label="Crop" optional error={errors['crop']}>
                  {(ids) => (
                    <Select
                      {...ids}
                      value={form.crop}
                      onChange={(event) => update('crop', event.target.value)}
                    >
                      <option value="">Not crop-specific</option>
                      {CROPS.map((c) => (
                        <option key={c} value={c}>
                          {CROP_LABELS[c]}
                        </option>
                      ))}
                    </Select>
                  )}
                </Field>
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
                <div className={styles.span2}>
                  <Checkbox
                    label="Published, visible to officers"
                    checked={form.published}
                    onChange={(event) => update('published', event.target.checked)}
                  />
                </div>
              </div>
            </section>

            <div className={`${styles.formSection} ${styles.formActions}`}>
              <Button type="submit">
                <IconCheck size={18} />
                {existing ? 'Save changes' : 'Save resource'}
              </Button>
              <Button variant="ghost" onClick={() => router.back()}>
                Cancel
              </Button>
              <span className="small muted">
                Unpublished resources are seen by administrators only.
              </span>
            </div>
          </Card>
        </form>

        <aside className={styles.aside} aria-label="Preview of the request">
          <Card padded as="div">
            <h3>What will be sent</h3>
            <p className="small muted" style={{ margin: 'var(--s-2) 0 var(--s-4)' }}>
              The body of the request after the shared schema has normalised it.
            </p>
            {saved ? (
              <pre className={styles.previewJson}>{JSON.stringify(saved, null, 2)}</pre>
            ) : (
              <p className="small muted">Save the form to see the validated body.</p>
            )}
          </Card>
        </aside>
      </div>
    </>
  );
}
