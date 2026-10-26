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

import { Button, Card, CardBody, CardHeader, Field, Input, Notice, PageHeader, Stamp } from '../ui';
import { BlockedAccounts } from '../account/BlockedAccounts';
import { DeleteAccount } from '../account/DeleteAccount';
import { LanguageButtons } from '../farmer/LanguageSwitch';
import { useToast } from '../ui/feedback';
import { useBuyer } from './BuyerShell';
import { ProcurementFields, toOrganizationBody, type OrgForm } from './ProcurementFields';
import styles from './buyer.module.css';

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
  const { profile, refresh, language, setLanguage } = useBuyer();
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

  return (
    <div className={styles.page}>
      <PageHeader title={t('buyer.profile.title', language)} subtitle={profile.organization.name} />

      <Card>
        <CardHeader
          title={t('buyer.profile.standing', language)}
          actions={
            showsStandingStamp(profile.organization.account_type, standing) ? (
              <Stamp kind={VERIFICATION_STAMPS[standing]}>
                {verificationLabel(standing, language)}
              </Stamp>
            ) : null
          }
        />
        <CardBody>
          <p>{verificationMessage(standing, language)}</p>
          {profile.verification.note ? (
            <p className={styles.muted}>
              {t('buyer.profile.corwadoNote', language)}{' '}
              <span dir="auto">{profile.verification.note}</span>
            </p>
          ) : null}
        </CardBody>
      </Card>

      {/* 2026-10-29: the language of the buyer screens, saved on the account. */}
      <Card>
        <CardHeader
          title={t('account.language', language)}
          subtitle={t('buyer.profile.languageLead', language)}
        />
        <CardBody>
          <LanguageButtons value={language} onChange={setLanguage} />
        </CardBody>
      </Card>

      <form
        className={styles.form}
        onSubmit={save}
        noValidate
        aria-label={t('buyer.profile.title', language)}
      >
        {failure ? (
          <Notice kind="error" title={t('buyer.profile.notSaved', language)}>
            {failure}
          </Notice>
        ) : null}

        <fieldset className={styles.fieldset}>
          <legend className={styles.legend}>{t('buyer.profile.you', language)}</legend>
          <div className={styles.formGrid}>
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
                  value={person.phone}
                  autoComplete="tel"
                  onChange={(e) => setPerson((p) => ({ ...p, phone: e.target.value }))}
                />
              )}
            </Field>
            <Field
              label={t('buyer.field.email', language)}
              hint={t('buyer.profile.emailHint', language)}
            >
              {(ids) => <Input {...ids} value={profile.person.email ?? ''} readOnly />}
            </Field>
          </div>
        </fieldset>

        <ProcurementFields
          form={org}
          onChange={setOrg}
          errors={errors}
          states={locations?.states ?? []}
          counties={locations?.counties ?? []}
          individual={profile.organization.account_type === 'individual'}
          language={language}
        />

        <div className={styles.actions}>
          <Button type="submit" disabled={busy}>
            {busy ? t('common.saving', language) : t('buyer.profile.save', language)}
          </Button>
        </div>
      </form>

      {/* 2026-10-28: person-level blocks, with Unblock, in the buyer's language. */}
      <Card>
        <CardBody>
          <BlockedAccounts language={language} />
        </CardBody>
      </Card>

      {/* 2026-10-20: the account deletes itself (hide now, keep for audit). */}
      <Card>
        <CardBody>
          <DeleteAccount language={language} />
        </CardBody>
      </Card>
    </div>
  );
}
