'use client';

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';

import {
  ACTIVITIES,
  PUBLIC_PROFILE_LIMITS,
  publicProfileSaveSchema,
  type PublicProfileOwn,
} from '@agri-erp/shared';

import { ABOUT_LABELS } from '@/components/account/AccountActivities';
import {
  Badge,
  Button,
  ButtonLink,
  Checkbox,
  Dialog,
  Field,
  Input,
  Notice,
  Select,
  Textarea,
} from '@/components/ui';
import { t, type Language, type TKey } from '@/lib/i18n';
import {
  ProfileError,
  getMyPublicProfile,
  publishMyPublicProfile,
  removeMyPhoto,
  saveMyPublicProfile,
  shrinkProfilePhoto,
  unpublishMyPublicProfile,
  uploadMyPhoto,
} from '@/lib/public-profile/client';

import { ProfileCard, ProfilePhoto } from './ProfileCard';
import styles from './public-profile.module.css';

/**
 * MY PUBLIC PROFILE (2026-10-23, public profiles v2): the editor from the
 * client's infographic, shared by the farmer side (in the farmer's language)
 * and the buyer side (English). One profile per account.
 *
 * Name, what you do, general location, about, products, services, an optional
 * photo (shrunk on the phone to 800 px before it is sent), "Show phone number
 * publicly" (off by default; signed-in users only) and "Allow in-app
 * messaging" (on). Save draft / Preview / Publish; once published, Unpublish
 * and View public profile. The draft is private; publishing is the owner's
 * confirmation, not staff approval; a public profile is not an endorsement.
 * Every input through the shared schema the route uses.
 */

interface Values {
  display_name: string;
  activities: string[];
  state_id: string;
  payam_id: string;
  about: string;
  products: string[];
  services: string[];
  show_phone: boolean;
  allow_messages: boolean;
}

const fromProfile = (p: PublicProfileOwn): Values => ({
  display_name: p.display_name ?? p.suggested_name,
  activities: [...p.activities],
  state_id: p.state_id ?? '',
  payam_id: p.payam_id ?? '',
  about: p.about ?? '',
  products: [...p.products],
  services: [...p.services],
  show_phone: p.show_phone,
  allow_messages: p.allow_messages,
});

interface Place {
  id: string;
  name: string;
  state_id?: string;
}

const STATUS_KEY: Record<PublicProfileOwn['status'], TKey> = {
  draft: 'pp.status.draft',
  published: 'pp.status.published',
  unpublished: 'pp.status.unpublished',
};

export interface ManageLink {
  href: string;
  label: TKey;
}

function TagInput({
  values,
  onChange,
  placeholder,
  language,
}: {
  values: string[];
  onChange: (next: string[]) => void;
  placeholder: string;
  language: Language;
}) {
  const [draft, setDraft] = useState('');
  const add = () => {
    const tag = draft.trim().slice(0, PUBLIC_PROFILE_LIMITS.tagMax);
    if (!tag) return;
    if (!values.some((v) => v.toLocaleLowerCase() === tag.toLocaleLowerCase())) {
      onChange([...values, tag]);
    }
    setDraft('');
  };
  return (
    <div>
      {values.length > 0 ? (
        <ul className={styles.tags}>
          {values.map((v) => (
            <li key={v} dir="auto">
              {v}
              <button
                type="button"
                className={styles.tagRemove}
                aria-label={`${t('pp.removeTag', language)} ${v}`}
                onClick={() => onChange(values.filter((x) => x !== v))}
              >
                ×
              </button>
            </li>
          ))}
        </ul>
      ) : null}
      {values.length < PUBLIC_PROFILE_LIMITS.tagsMax ? (
        <div className={styles.tagEntry}>
          <Input
            dir="auto"
            value={draft}
            maxLength={PUBLIC_PROFILE_LIMITS.tagMax}
            placeholder={placeholder}
            aria-label={placeholder}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                add();
              }
            }}
          />
          <Button type="button" variant="secondary" size="small" onClick={add}>
            {t('pp.add', language)}
          </Button>
        </div>
      ) : null}
    </div>
  );
}

function Switch({
  label,
  hint,
  checked,
  onChange,
  language,
}: {
  label: string;
  hint: string;
  checked: boolean;
  onChange: (next: boolean) => void;
  language: Language;
}) {
  return (
    <div className={styles.switchRow}>
      <div>
        <strong>{label}</strong>
        <span className="small muted">{hint}</span>
      </div>
      <label className={styles.switch}>
        <input
          type="checkbox"
          role="switch"
          aria-checked={checked}
          checked={checked}
          onChange={(e) => onChange(e.target.checked)}
        />
        {checked ? t('pp.on', language) : t('pp.off', language)}
      </label>
    </div>
  );
}

export function ProfileEditor({
  language,
  manage,
  deleteHref,
}: {
  language: Language;
  /** Where this side of the app manages its posts. */
  manage: readonly ManageLink[];
  /** Where Delete account is (settings). */
  deleteHref: string;
}) {
  const lang = language === 'ar' ? 'ar' : 'en';
  const labels = ABOUT_LABELS[lang];
  const [profile, setProfile] = useState<PublicProfileOwn | null>(null);
  const [values, setValues] = useState<Values | null>(null);
  const [states, setStates] = useState<Place[]>([]);
  const [payams, setPayams] = useState<Place[]>([]);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [failure, setFailure] = useState<string | null>(null);
  const [notice, setNotice] = useState<TKey | null>(null);
  const [busy, setBusy] = useState(false);
  const [photoBusy, setPhotoBusy] = useState(false);
  const [preview, setPreview] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    getMyPublicProfile()
      .then((p) => {
        setProfile(p);
        setValues(fromProfile(p));
      })
      .catch((e: unknown) => setFailure(e instanceof Error ? e.message : String(e)));
    fetch('/api/locations', { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : null))
      .then((b: { data?: { states?: Place[]; payams?: Place[] } } | null) => {
        setStates(b?.data?.states ?? []);
        setPayams(b?.data?.payams ?? []);
      })
      .catch(() => undefined);
  }, []);

  if (failure && !profile) {
    return (
      <Notice kind="error">
        <p className="small">{failure}</p>
      </Notice>
    );
  }
  if (!profile || !values) return <p className="muted">{t('pp.loading', language)}</p>;

  const set = <K extends keyof Values>(key: K, value: Values[K]) => {
    setValues((v) => (v ? { ...v, [key]: value } : v));
    setErrors((e) => ({ ...e, [key]: '' }));
    setNotice(null);
  };
  const toggleActivity = (a: string) =>
    set(
      'activities',
      values.activities.includes(a)
        ? values.activities.filter((x) => x !== a)
        : [...values.activities, a],
    );

  const failed = (e: unknown) => {
    if (e instanceof ProfileError) {
      setErrors(e.fields);
      setFailure(e.message);
    } else setFailure(e instanceof Error ? e.message : String(e));
  };

  /** Validates with the route's schema and saves; false when anything is wrong. */
  async function save(): Promise<boolean> {
    if (!values) return false;
    setFailure(null);
    setNotice(null);
    const check = publicProfileSaveSchema.safeParse(values);
    if (!check.success) {
      const next: Record<string, string> = {};
      for (const issue of check.error.issues) {
        const key = String(issue.path[0] ?? '');
        if (key && !next[key]) next[key] = issue.message;
      }
      setErrors(next);
      setPreview(false);
      return false;
    }
    try {
      const saved = await saveMyPublicProfile(check.data);
      setProfile(saved);
      setValues(fromProfile(saved));
      return true;
    } catch (e) {
      failed(e);
      setPreview(false);
      return false;
    }
  }

  async function run(work: () => Promise<void>) {
    setBusy(true);
    try {
      await work();
    } finally {
      setBusy(false);
    }
  }

  const onSave = () =>
    run(async () => {
      if (await save()) setNotice('pp.saved');
    });

  const onPublish = () =>
    run(async () => {
      setConfirming(false);
      if (!(await save())) return;
      try {
        setProfile(await publishMyPublicProfile());
        setNotice('pp.publishedNow');
      } catch (e) {
        failed(e);
      }
    });

  const onUnpublish = () =>
    run(async () => {
      setFailure(null);
      try {
        setProfile(await unpublishMyPublicProfile());
        setNotice('pp.unpublishedNow');
      } catch (e) {
        failed(e);
      }
    });

  async function onPhoto(file: File | undefined) {
    if (!file) return;
    setPhotoBusy(true);
    setFailure(null);
    try {
      const shrunk = await shrinkProfilePhoto(file);
      setProfile(await uploadMyPhoto(shrunk));
    } catch (e) {
      failed(e);
    } finally {
      setPhotoBusy(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  }

  async function onRemovePhoto() {
    setPhotoBusy(true);
    setFailure(null);
    try {
      setProfile(await removeMyPhoto());
    } catch (e) {
      failed(e);
    } finally {
      setPhotoBusy(false);
    }
  }

  const status = profile.status;
  const published = status === 'published';
  const statePayams = payams.filter((p) => p.state_id === values.state_id);
  const stateName = states.find((s) => s.id === values.state_id)?.name ?? null;
  const payamName = payams.find((p) => p.id === values.payam_id)?.name ?? null;
  const shownName = values.display_name.trim() || profile.suggested_name;

  const notes = (
    <div className={styles.note}>
      <p>
        <strong>{t('pp.draftPrivate', language)}</strong>
      </p>
      <p className="small">{t('pp.notEndorsement', language)}</p>
    </div>
  );

  const header = (
    <header className={styles.head}>
      <h1>{t('pp.title', language)}</h1>
      <p className="muted small">{t('pp.lead', language)}</p>
      <div className={styles.statusRow}>
        <span>
          {t('pp.statusNow', language)}{' '}
          <Badge tone={published ? 'leaf' : 'neutral'}>{t(STATUS_KEY[status], language)}</Badge>
        </span>
        {published && profile.public_id ? (
          <Link className="small" href={`/market/p/${profile.public_id}`}>
            {t('pp.viewPublic', language)}
          </Link>
        ) : null}
      </div>
      {failure ? (
        <Notice kind="error">
          <p className="small">{failure}</p>
        </Notice>
      ) : null}
      {notice ? <Notice kind="success">{t(notice, language)}</Notice> : null}
    </header>
  );

  const publishDialog = (
    <Dialog
      open={confirming}
      onClose={() => setConfirming(false)}
      title={t('pp.publishTitle', language)}
      footer={
        <>
          <Button variant="ghost" onClick={() => setConfirming(false)} disabled={busy}>
            {t('msg.cancel', language)}
          </Button>
          <Button onClick={() => void onPublish()} disabled={busy}>
            {t('pp.publish', language)}
          </Button>
        </>
      }
    >
      <p>{t('pp.publishConfirm', language)}</p>
      <p className="small muted">{t('pp.notEndorsement', language)}</p>
    </Dialog>
  );

  if (preview) {
    return (
      <div className={styles.page}>
        {header}
        <h2>{t('pp.previewTitle', language)}</h2>
        <ProfileCard
          heading="h2"
          language={language}
          profile={{
            display_name: shownName,
            photo_url: profile.photo_url,
            activities: values.activities,
            location: { state: stateName, payam: payamName },
            about: values.about.trim() || null,
            products: values.products,
            services: values.services,
            verified_organisation: profile.verified_organisation,
            member_since: profile.member_since,
          }}
        >
          {values.show_phone ? (
            <p className="small muted">{t('pp.showPhoneOn', language)}</p>
          ) : null}
        </ProfileCard>
        {notes}
        <div className={styles.actions}>
          <Button variant="secondary" onClick={() => setPreview(false)}>
            {t('pp.closePreview', language)}
          </Button>
          {published ? null : (
            <Button disabled={busy} onClick={() => setConfirming(true)}>
              {t('pp.publish', language)}
            </Button>
          )}
        </div>
        {publishDialog}
      </div>
    );
  }

  return (
    <div className={styles.page}>
      {header}
      {published ? <p className="small muted">{t('pp.liveEdits', language)}</p> : null}

      <form
        className={styles.form}
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          void onSave();
        }}
      >
        <Field
          label={t('pp.name', language)}
          hint={t('pp.nameHint', language)}
          error={errors.display_name || undefined}
        >
          {(ids) => (
            <Input
              {...ids}
              dir="auto"
              maxLength={PUBLIC_PROFILE_LIMITS.displayNameMax}
              value={values.display_name}
              onChange={(e) => set('display_name', e.target.value)}
            />
          )}
        </Field>

        <div>
          <fieldset className={styles.choices}>
            <legend>{t('pp.roles', language)}</legend>
            {ACTIVITIES.map((a) => (
              <Checkbox
                key={a}
                label={labels[a] ?? a}
                checked={values.activities.includes(a)}
                onChange={() => toggleActivity(a)}
              />
            ))}
          </fieldset>
          {errors.activities ? (
            <p className="small" role="alert">
              {errors.activities}
            </p>
          ) : null}
        </div>

        <div className={styles.two}>
          <Field label={t('pp.state', language)} optional error={errors.state_id || undefined}>
            {(ids) => (
              <Select
                {...ids}
                value={values.state_id}
                onChange={(e) => {
                  set('state_id', e.target.value);
                  set('payam_id', '');
                }}
              >
                <option value="">{t('register.select', language)}</option>
                {states.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <Field label={t('pp.payam', language)} optional error={errors.payam_id || undefined}>
            {(ids) => (
              <Select
                {...ids}
                value={values.payam_id}
                disabled={!values.state_id}
                onChange={(e) => set('payam_id', e.target.value)}
              >
                <option value="">{t('register.select', language)}</option>
                {statePayams.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </Select>
            )}
          </Field>
        </div>
        <p className="small muted">{t('pp.locationHint', language)}</p>

        <Field
          label={t('pp.about', language)}
          hint={t('pp.aboutHint', language)}
          optional
          error={errors.about || undefined}
        >
          {(ids) => (
            <Textarea
              {...ids}
              rows={4}
              dir="auto"
              maxLength={PUBLIC_PROFILE_LIMITS.aboutMax}
              value={values.about}
              onChange={(e) => set('about', e.target.value)}
            />
          )}
        </Field>

        <Field
          label={t('pp.products', language)}
          hint={t('pp.tagsHint', language)}
          optional
          error={errors.products || undefined}
        >
          {() => (
            <TagInput
              values={values.products}
              onChange={(next) => set('products', next)}
              placeholder={t('pp.addProduct', language)}
              language={language}
            />
          )}
        </Field>
        <Field
          label={t('pp.services', language)}
          hint={t('pp.tagsHint', language)}
          optional
          error={errors.services || undefined}
        >
          {() => (
            <TagInput
              values={values.services}
              onChange={(next) => set('services', next)}
              placeholder={t('pp.addService', language)}
              language={language}
            />
          )}
        </Field>

        <div>
          <p className="label">{t('pp.photo', language)}</p>
          <div className={styles.photoRow}>
            <ProfilePhoto name={shownName} url={profile.photo_url} small />
            {profile.public_id ? (
              <div className={styles.photoButtons}>
                <Button
                  type="button"
                  variant="secondary"
                  size="small"
                  disabled={photoBusy}
                  onClick={() => fileRef.current?.click()}
                >
                  {profile.photo_url ? t('pp.changePhoto', language) : t('pp.addPhoto', language)}
                </Button>
                {profile.photo_url ? (
                  <Button
                    type="button"
                    variant="ghost"
                    size="small"
                    disabled={photoBusy}
                    onClick={() => void onRemovePhoto()}
                  >
                    {t('pp.removePhoto', language)}
                  </Button>
                ) : null}
                <input
                  ref={fileRef}
                  className={styles.hiddenInput}
                  type="file"
                  accept="image/jpeg,image/png,image/webp"
                  onChange={(e) => void onPhoto(e.target.files?.[0])}
                />
              </div>
            ) : (
              <p className="small muted">{t('pp.photoSaveFirst', language)}</p>
            )}
          </div>
          <p className="small muted">
            {photoBusy ? t('pp.photoSending', language) : t('pp.photoHint', language)}
          </p>
        </div>

        <div>
          <Switch
            label={t('pp.showPhone', language)}
            hint={t(values.show_phone ? 'pp.showPhoneOn' : 'pp.showPhoneOff', language)}
            checked={values.show_phone}
            onChange={(v) => set('show_phone', v)}
            language={language}
          />
          <Switch
            label={t('pp.allowMessages', language)}
            hint={t(values.allow_messages ? 'pp.allowMessagesOn' : 'pp.allowMessagesOff', language)}
            checked={values.allow_messages}
            onChange={(v) => set('allow_messages', v)}
            language={language}
          />
        </div>

        <div className={styles.actions}>
          <Button type="submit" variant="secondary" disabled={busy}>
            {published ? t('pp.save', language) : t('pp.saveDraft', language)}
          </Button>
          <Button type="button" variant="secondary" onClick={() => setPreview(true)}>
            {t('pp.preview', language)}
          </Button>
          {published ? (
            <Button
              type="button"
              variant="ghost"
              disabled={busy}
              onClick={() => void onUnpublish()}
            >
              {t('pp.unpublish', language)}
            </Button>
          ) : (
            <Button type="button" disabled={busy} onClick={() => setConfirming(true)}>
              {t('pp.publish', language)}
            </Button>
          )}
          {published && profile.public_id ? (
            <ButtonLink href={`/market/p/${profile.public_id}`} variant="ghost">
              {t('pp.viewPublic', language)}
            </ButtonLink>
          ) : null}
        </div>
      </form>

      {notes}

      <section>
        <h2 className="label">{t('pp.manage', language)}</h2>
        <ul className={styles.links}>
          {manage.map((m) => (
            <li key={m.href}>
              <Link href={m.href}>{t(m.label, language)}</Link>
            </li>
          ))}
          <li>
            <Link href={deleteHref}>{t('pp.deleteAccount', language)}</Link>
            <p className="small muted">{t('pp.deleteHint', language)}</p>
          </li>
        </ul>
      </section>
      {publishDialog}
    </div>
  );
}
