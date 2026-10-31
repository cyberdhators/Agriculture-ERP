'use client';

import { useEffect, useState, type FormEvent } from 'react';

import { buyerProfilePatchSchema, zodErrorToApiError } from '@agri-erp/shared';

import {
  BuyerApiError,
  getLocations,
  updateProfile,
  type BuyerProfile as Profile,
  type Locations,
} from '@/lib/buyer/api';
import {
  VERIFICATION_STAMPS,
  showsStandingStamp,
  verificationLabel,
  verificationMessage,
} from '@/lib/buyer/labels';
import { t } from '@/lib/i18n';
import { useArabicEnabled } from '@/lib/settings/client';

import { MyAvatar } from '@/components/account/MyAvatar';
import { AppearanceRow } from '@/components/account/Appearance';
import css from '@/components/account/settings.module.css';

import { Button, Field, Input, Notice, Stamp } from '../ui';
import { BlockedAccounts } from '../account/BlockedAccounts';
import { DeleteAccount } from '../account/DeleteAccount';
import { RowIcon } from '../farmer/SecuritySettings';
import { useToast } from '../ui/feedback';
import { useBuyer } from './BuyerShell';
import { ProcurementFields, toOrganizationBody, type OrgForm } from './ProcurementFields';
import styles from './buyer.module.css';

const GLOBE =
  'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18Zm-9 9h18M12 3c2.5 2.7 3.8 5.7 3.8 9s-1.3 6.3-3.8 9c-2.5-2.7-3.8-5.7-3.8-9S9.5 5.7 12 3Z';

/**
 * THE ORGANISATION PROFILE (C-14B.14).
 *
 * What the buyer may change: their own name and phone, the organisation's
 * details and its procurement preferences. What they may not: their email and
 * password (the sign-in service's), and their standing (an administrator's).
 * Both are shown here, read-only, so nobody wonders where they went.
 *
 * Only the fields that changed are sent, and the patch is validated by the
 * same shared schema the route runs.
 *
 * 2026-10-31 (the owner: "more beautiful and more appealing"): the shape of
 * the phone account's Account page -- a profile card (who, the organisation,
 * the sign-in address, the standing), Preferences (language) as a row, the
 * editable details as grouped cards with one Save, then Blocked accounts and
 * Delete my account as rows. The email is shown on the profile card, so the
 * read-only email field went. Every action is the one it was.
 */

const fromProfile = (p: Profile): OrgForm => ({
  organization_name: p.organization.name,
  organization_type: p.organization.organization_type,
  registration_number: p.organization.registration_number ?? '',
  tax_id: p.organization.tax_id ?? '',
  country_code: p.organization.country_code,
  state_id: p.organization.state_id ?? '',
  county_id: p.organization.county_id ?? '',
  city: p.organization.city ?? '',
  address: p.organization.address ?? '',
  website: p.organization.website ?? '',
  description: p.organization.description ?? '',
  interested_categories: p.procurement.interested_categories,
  interested_products: p.procurement.interested_products.join(', '),
  preferred_state_ids: p.procurement.preferred_state_ids,
  min_quantity: p.procurement.min_quantity === null ? '' : String(p.procurement.min_quantity),
  max_quantity: p.procurement.max_quantity === null ? '' : String(p.procurement.max_quantity),
  preferred_unit: p.procurement.preferred_unit ?? '',
  delivery_locations: p.procurement.delivery_locations.join(', '),
  purchasing_months: p.procurement.purchasing_months,
  payment_preferences: p.procurement.payment_preferences,
});

export function BuyerProfile() {
  const toast = useToast();
  const { profile, refresh, language, setLanguage, signOut } = useBuyer();
  const [person, setPerson] = useState({
    given_name: profile.person.given_name,
    family_name: profile.person.family_name,
    phone: profile.person.phone,
  });
  const [org, setOrg] = useState<OrgForm>(() => fromProfile(profile));
  const [locations, setLocations] = useState<Locations | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [failure, setFailure] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    getLocations()
      .then(setLocations)
      .catch(() => setLocations(null));
  }, []);

  const save = async (event: FormEvent) => {
    event.preventDefault();
    setFailure(null);
    const individual = profile.organization.account_type === 'individual';
    const before: Record<string, unknown> = {
      given_name: profile.person.given_name,
      family_name: profile.person.family_name,
      phone: profile.person.phone,
      ...toOrganizationBody(fromProfile(profile), true, individual),
    };
    const after: Record<string, unknown> = {
      ...person,
      ...toOrganizationBody(org, true, individual),
    };
    const changed = Object.fromEntries(
      Object.entries(after).filter(([k, v]) => JSON.stringify(v) !== JSON.stringify(before[k])),
    );
    if (Object.keys(changed).length === 0) {
      toast.show({ kind: 'warn', title: t('buyer.profile.nothingChanged', language) });
      return;
    }
    const parsed = buyerProfilePatchSchema.safeParse(changed);
    if (!parsed.success) {
      setErrors(zodErrorToApiError(parsed.error).body.error.fields ?? {});
      return;
    }
    setErrors({});
    setBusy(true);
    try {
      await updateProfile(parsed.data);
      await refresh();
      toast.show({ kind: 'success', title: t('buyer.profile.saved', language) });
    } catch (e) {
      if (e instanceof BuyerApiError) {
        setErrors(e.fields);
        setFailure(e.message);
      } else {
        setFailure(t('buyer.profile.saveFailed', language));
      }
    } finally {
      setBusy(false);
    }
  };

  const standing = profile.verification.status;
  const arabic = useArabicEnabled();
  const initials =
    `${profile.person.given_name.charAt(0)}${profile.person.family_name.charAt(0)}`.toUpperCase();
  // The standing is said in words only where it asks something of the buyer;
  // "verified" and "not required" are the badge (or nothing) alone.
  const standingWords = standing !== 'verified' && standing !== 'not_required';

  return (
    <div className={styles.page}>
      <h1 className="visually-hidden">{t('buyer.profile.title', language)}</h1>

      <div className={css.page}>
        <section className={css.profile} aria-label={t('buyer.profile.standing', language)}>
          <MyAvatar initials={initials} />
          <div className={css.profileText}>
            <span className={css.profileName} dir="auto">
              {profile.person.given_name} {profile.person.family_name}
            </span>
            <span className={css.profileId} dir="auto">
              {profile.organization.name}
            </span>
            <span className={css.profileMeta}>
              {profile.person.email ? <span dir="ltr">{profile.person.email}</span> : null}
              {profile.person.phone ? <span dir="ltr">{profile.person.phone}</span> : null}
            </span>
          </div>
          {showsStandingStamp(profile.organization.account_type, standing) ? (
            <span style={{ marginInlineStart: 'auto' }}>
              <Stamp kind={VERIFICATION_STAMPS[standing]}>
                {verificationLabel(standing, language)}
              </Stamp>
            </span>
          ) : null}
        </section>

        {standingWords || profile.verification.note ? (
          <Notice kind={standing === 'suspended' ? 'error' : 'info'}>
            {standingWords ? (
              <p className="small">{verificationMessage(standing, language)}</p>
            ) : null}
            {profile.verification.note ? (
              <p className="small">
                {t('buyer.profile.corwadoNote', language)}{' '}
                <span dir="auto">{profile.verification.note}</span>
              </p>
            ) : null}
          </Notice>
        ) : null}

        {/* 2026-10-29: the language of the buyer screens, saved on the account. */}
        <section className={css.group} aria-labelledby="bp-preferences">
          <h2 id="bp-preferences" className={css.groupTitle}>
            {t('set.preferences', language)}
          </h2>
          <ul className={css.list}>
            <li className={css.row}>
              <RowIcon d={GLOBE} />
              <span className={css.rowText}>
                <span className={css.rowLabel}>{t('account.language', language)}</span>
              </span>
              {arabic ? (
                <span
                  className={css.segmented}
                  role="group"
                  aria-label={t('account.language', language)}
                >
                  <button
                    type="button"
                    aria-pressed={language === 'en'}
                    onClick={() => setLanguage('en')}
                  >
                    {t('language.name', 'en')}
                  </button>
                  <button
                    type="button"
                    aria-pressed={language === 'ar'}
                    onClick={() => setLanguage('ar')}
                    dir="rtl"
                    lang="ar"
                  >
                    {t('language.arabicNative', 'en')}
                  </button>
                </span>
              ) : (
                <span className={css.rowValue}>{t('language.name', language)}</span>
              )}
            </li>
            {/* 2026-10-31: light, dark, or follow the phone. */}
            <AppearanceRow language={language === 'ar' ? 'ar' : 'en'} />
          </ul>
        </section>

        <form
          className={styles.sections}
          onSubmit={save}
          noValidate
          aria-label={t('buyer.profile.title', language)}
        >
          {failure ? (
            <Notice kind="error" title={t('buyer.profile.notSaved', language)}>
              {failure}
            </Notice>
          ) : null}

          <section className={css.group} aria-labelledby="bp-you">
            <h2 id="bp-you" className={css.groupTitle}>
              {t('buyer.profile.you', language)}
            </h2>
            <div className={`${css.formCard} ${styles.formGrid}`}>
              <Field label={t('buyer.field.givenName', language)} error={errors.given_name}>
                {(ids) => (
                  <Input
                    {...ids}
                    value={person.given_name}
                    autoComplete="given-name"
                    onChange={(e) => setPerson((p) => ({ ...p, given_name: e.target.value }))}
                  />
                )}
              </Field>
              <Field label={t('buyer.field.familyName', language)} error={errors.family_name}>
                {(ids) => (
                  <Input
                    {...ids}
                    value={person.family_name}
                    autoComplete="family-name"
                    onChange={(e) => setPerson((p) => ({ ...p, family_name: e.target.value }))}
                  />
                )}
              </Field>
              <Field
                label={t('buyer.field.mobile', language)}
                hint={t('buyer.field.mobileHint', language)}
                error={errors.phone}
              >
                {(ids) => (
                  <Input
                    {...ids}
                    type="tel"
                    dir="ltr"
                    value={person.phone}
                    autoComplete="tel"
                    onChange={(e) => setPerson((p) => ({ ...p, phone: e.target.value }))}
                  />
                )}
              </Field>
            </div>
          </section>

          <ProcurementFields
            form={org}
            onChange={setOrg}
            errors={errors}
            states={locations?.states ?? []}
            counties={locations?.counties ?? []}
            individual={profile.organization.account_type === 'individual'}
            language={language}
          />

          <div className={css.actions}>
            <Button type="submit" disabled={busy}>
              {busy ? t('common.saving', language) : t('buyer.profile.save', language)}
            </Button>
          </div>
        </form>

        <section className={css.group} aria-labelledby="bp-security">
          <h2 id="bp-security" className={css.groupTitle}>
            {t('set.security', language)}
          </h2>
          <ul className={css.list}>
            {/* 2026-10-28: person-level blocks, with Unblock, in the buyer's language. */}
            <BlockedAccounts language={language} variant="row" />
          </ul>
        </section>

        <ul className={css.list}>
          <li>
            <button
              type="button"
              className={`${css.row} ${css.rowButton} ${css.danger}`}
              onClick={() => void signOut()}
            >
              <RowIcon d="M15 4h4v16h-4M10 8l-4 4 4 4M6 12h10" />
              <span className={css.rowText}>
                <span className={css.rowLabel}>{t('account.signOut', language)}</span>
              </span>
            </button>
          </li>
          {/* 2026-10-20: the account deletes itself (hide now, keep for audit). */}
          <DeleteAccount language={language} variant="row" />
        </ul>
      </div>
    </div>
  );
}
