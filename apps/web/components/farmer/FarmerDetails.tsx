'use client';

import { useMemo, useState } from 'react';

import css from '@/components/account/settings.module.css';
import { Button, Field, Input, Notice, Select } from '@/components/ui';
import { maxBirthYear } from '@/lib/farmers/schema';
import { COUNTIES, PAYAMS, STATES } from '@/lib/fixtures/p1';
import { farmerApi, FarmerApiError, useFarmerSession } from '@/lib/farmer-session';

import styles from './farmer.module.css';

const W = {
  en: {
    title: 'Your details',
    // 2026-10-31: one short sentence (it was two long ones).
    lead: 'Sign-up did not ask for these when you joined.',
    sex: 'Sex',
    female: 'Female',
    male: 'Male',
    yob: 'Year of birth',
    state: 'State or area',
    county: 'County',
    payam: 'Payam',
    village: 'Village or boma',
    choose: 'Choose…',
    save: 'Save details',
    saved: 'Saved.',
    failed: 'Your details were not saved.',
  },
  ar: {
    title: 'تفاصيلك',
    lead: 'لم يطلب التسجيل هذه التفاصيل حين انضممت.',
    sex: 'الجنس',
    female: 'أنثى',
    male: 'ذكر',
    yob: 'سنة الميلاد',
    state: 'الولاية أو المنطقة',
    county: 'المقاطعة',
    payam: 'البايام',
    village: 'القرية أو البوما',
    choose: 'اختر…',
    save: 'حفظ التفاصيل',
    saved: 'تم الحفظ.',
    failed: 'لم تُحفظ تفاصيلك.',
  },
} as const;

/**
 * 2026-10-28 (user journeys): the details phone sign-up did not ask for --
 * sex, year of birth, place and village -- given later
 * (PATCH /api/farmer/me/details). Since 2026-11-02 sign-up requires them all
 * (owner: "make the registration form compulsory"), so only an account made
 * between those dates sees this. Shown only while something is missing; a
 * field already given is not offered again here (the farmer record keeps it).
 */
export function FarmerDetails() {
  const { farmer, language, refresh } = useFarmerSession();
  const w = W[language === 'ar' ? 'ar' : 'en'];
  const [sex, setSex] = useState<'' | 'f' | 'm'>('');
  const [year, setYear] = useState('');
  const [stateId, setStateId] = useState('');
  const [countyId, setCountyId] = useState('');
  const [payamId, setPayamId] = useState('');
  const [village, setVillage] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [fields, setFields] = useState<Record<string, string>>({});

  const counties = useMemo(() => COUNTIES.filter((c) => c.stateId === stateId), [stateId]);
  const payams = useMemo(() => PAYAMS.filter((p) => p.countyId === countyId), [countyId]);

  if (!farmer) return null;
  const needSex = farmer.sex === null;
  const needYear = farmer.year_of_birth === null;
  const needPlace = farmer.payam_id === null;
  const needVillage = !farmer.village;
  if (!needSex && !needYear && !needPlace && !needVillage) return null;

  async function save() {
    const body: Record<string, unknown> = {};
    if (needSex && sex) body.sex = sex;
    if (needYear && year.trim()) body.year_of_birth = Number(year);
    if (needPlace && payamId) body.payam_id = payamId;
    if (needVillage && village.trim()) body.village = village.trim();
    setBusy(true);
    setMessage(null);
    setFields({});
    try {
      await farmerApi('/api/farmer/me/details', { method: 'PATCH', body: JSON.stringify(body) });
      await refresh();
      setMessage({ ok: true, text: w.saved });
    } catch (error) {
      if (error instanceof FarmerApiError) {
        setFields(error.fields);
        setMessage({ ok: false, text: error.message });
      } else setMessage({ ok: false, text: w.failed });
    } finally {
      setBusy(false);
    }
  }

  return (
    // 2026-10-31: on a white form card, as the Account page's settings are.
    <section className={css.formCard} aria-labelledby="farmer-details-title">
      <h2 id="farmer-details-title">{w.title}</h2>
      <p className="small muted">{w.lead}</p>
      {message ? <Notice kind={message.ok ? 'success' : 'error'} title={message.text} /> : null}
      <div className={styles.stack}>
        {needSex ? (
          <Field label={w.sex} optional error={fields.sex}>
            {(ids) => (
              <Select
                {...ids}
                value={sex}
                onChange={(e) => setSex(e.target.value as '' | 'f' | 'm')}
              >
                <option value="">{w.choose}</option>
                <option value="f">{w.female}</option>
                <option value="m">{w.male}</option>
              </Select>
            )}
          </Field>
        ) : null}
        {needYear ? (
          <Field
            label={w.yob}
            optional
            hint={`1920–${maxBirthYear()}`}
            error={fields.year_of_birth}
          >
            {(ids) => (
              <Input
                {...ids}
                inputMode="numeric"
                maxLength={4}
                className="mono"
                value={year}
                onChange={(e) => setYear(e.target.value.replace(/\D/g, '').slice(0, 4))}
              />
            )}
          </Field>
        ) : null}
        {needPlace ? (
          <>
            <Field label={w.state} optional>
              {(ids) => (
                <Select
                  {...ids}
                  value={stateId}
                  onChange={(e) => {
                    setStateId(e.target.value);
                    setCountyId('');
                    setPayamId('');
                  }}
                >
                  <option value="">{w.choose}</option>
                  {STATES.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
            <Field label={w.county} optional>
              {(ids) => (
                <Select
                  {...ids}
                  value={countyId}
                  disabled={!stateId}
                  onChange={(e) => {
                    setCountyId(e.target.value);
                    setPayamId('');
                  }}
                >
                  <option value="">{w.choose}</option>
                  {counties.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
            <Field label={w.payam} optional error={fields.payam_id}>
              {(ids) => (
                <Select
                  {...ids}
                  value={payamId}
                  disabled={!countyId}
                  onChange={(e) => setPayamId(e.target.value)}
                >
                  <option value="">{w.choose}</option>
                  {payams.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
          </>
        ) : null}
        {needVillage ? (
          <Field label={w.village} optional error={fields.village}>
            {(ids) => (
              <Input
                {...ids}
                dir="auto"
                value={village}
                onChange={(e) => setVillage(e.target.value)}
              />
            )}
          </Field>
        ) : null}
        <div className={css.actions}>
          <Button variant="primary" onClick={() => void save()} disabled={busy}>
            {busy ? '…' : w.save}
          </Button>
        </div>
      </div>
    </section>
  );
}
