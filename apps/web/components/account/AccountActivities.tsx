'use client';

import { useEffect, useState } from 'react';

import {
  ACTIVITIES,
  GROUP_KINDS,
  PROFILE_KINDS,
  accountProfileSchema,
  type Activity,
  type GroupKind,
  type ProfileKind,
} from '@agri-erp/shared';

import { Button, Checkbox, Field, Notice, Select } from '@/components/ui';

type Lang = 'en' | 'ar';

export const ABOUT_LABELS: Record<Lang, Record<string, string>> = {
  en: {
    title: 'Tell us about yourself',
    lead: 'Optional. It helps AgriOne show the right shortcuts. You can still buy, sell, offer services and ask for advice, whatever you choose.',
    iAm: 'I am / we are',
    individual: 'Myself (individual)',
    group: 'A group',
    business: 'A business',
    institution: 'An institution',
    groupKind: 'What kind of group',
    producer_group: 'Producer group',
    cooperative: 'Cooperative',
    vsla: 'VSLA (savings group)',
    sacco: 'SACCO',
    other_association: 'Other association',
    activities: 'What you do (choose any)',
    farmer: 'Farmer',
    trader: 'Trader',
    processor: 'Processor',
    input_supplier: 'Inputs',
    transport: 'Transport',
    other_services: 'Other services',
    knowledge_provider: 'Knowledge provider',
    financial_services: 'Financial services',
    buyer: 'Buyer',
    save: 'Save',
    saving: 'Saving…',
    skip: 'Skip for now',
    saved: 'Saved.',
    failed: 'Not saved. Please try again.',
    choose: 'Choose…',
  },
  ar: {
    title: 'أخبرنا عن نفسك',
    lead: 'اختياري. يساعد أجري ون على عرض الاختصارات المناسبة. يمكنك دائماً الشراء والبيع وتقديم الخدمات وطلب النصيحة مهما اخترت.',
    iAm: 'أنا / نحن',
    individual: 'أنا (فرد)',
    group: 'مجموعة',
    business: 'شركة',
    institution: 'مؤسسة',
    groupKind: 'نوع المجموعة',
    producer_group: 'مجموعة منتجين',
    cooperative: 'تعاونية',
    vsla: 'مجموعة ادخار (VSLA)',
    sacco: 'ساكو (SACCO)',
    other_association: 'جمعية أخرى',
    activities: 'ماذا تعمل (اختر ما ينطبق)',
    farmer: 'مزارع',
    trader: 'تاجر',
    processor: 'مُصنِّع',
    input_supplier: 'مدخلات زراعية',
    transport: 'نقل',
    other_services: 'خدمات أخرى',
    knowledge_provider: 'مقدّم معرفة',
    financial_services: 'خدمات مالية',
    buyer: 'مشتري',
    save: 'حفظ',
    saving: 'جارٍ الحفظ…',
    skip: 'تخطَّ الآن',
    saved: 'تم الحفظ.',
    failed: 'لم يتم الحفظ. حاول مرة أخرى.',
    choose: 'اختر…',
  },
};

/**
 * WHO YOU ARE, WHAT YOU DO (2026-10-19, CORWADO's specification): optional,
 * skippable, editable later; it never restricts what the account can do.
 * Saved to the account itself (GET/PUT /api/account/profile), so it is the
 * same whether reached from the farmer side or the buyer side.
 */
export function AccountActivities({ language, next }: { language: Lang; next?: string }) {
  const w = ABOUT_LABELS[language];
  const [kind, setKind] = useState<ProfileKind>('individual');
  const [groupKind, setGroupKind] = useState<GroupKind | ''>('');
  const [activities, setActivities] = useState<Activity[]>([]);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  useEffect(() => {
    void fetch('/api/account/profile', { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : null))
      .then(
        (
          b: {
            data?: {
              profile_kind: ProfileKind;
              group_kind: GroupKind | null;
              activities: Activity[];
            };
          } | null,
        ) => {
          if (!b?.data) return;
          setKind(b.data.profile_kind);
          setGroupKind(b.data.group_kind ?? '');
          setActivities(b.data.activities);
        },
      )
      .catch(() => undefined);
  }, []);

  const toggle = (a: Activity) =>
    setActivities((list) => (list.includes(a) ? list.filter((x) => x !== a) : [...list, a]));

  async function save() {
    const body = {
      profile_kind: kind,
      group_kind: kind === 'group' ? groupKind || undefined : null,
      activities,
    };
    const parsed = accountProfileSchema.safeParse(body);
    if (!parsed.success) {
      setMessage({ ok: false, text: parsed.error.issues[0]?.message ?? w.failed! });
      return;
    }
    setBusy(true);
    setMessage(null);
    try {
      const res = await fetch('/api/account/profile', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error();
      if (next) {
        window.location.assign(next);
        return;
      }
      setMessage({ ok: true, text: w.saved! });
    } catch {
      setMessage({ ok: false, text: w.failed! });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ display: 'grid', gap: 'var(--s-4)', maxWidth: 560 }}>
      <div>
        <h1>{w.title}</h1>
        <p className="muted">{w.lead}</p>
      </div>
      {message ? (
        <Notice kind={message.ok ? 'success' : 'error'}>
          <p className="small">{message.text}</p>
        </Notice>
      ) : null}
      <Field label={w.iAm!}>
        {(ids) => (
          <Select {...ids} value={kind} onChange={(e) => setKind(e.target.value as ProfileKind)}>
            {PROFILE_KINDS.map((k) => (
              <option key={k} value={k}>
                {w[k]}
              </option>
            ))}
          </Select>
        )}
      </Field>
      {kind === 'group' ? (
        <Field label={w.groupKind!}>
          {(ids) => (
            <Select
              {...ids}
              value={groupKind}
              onChange={(e) => setGroupKind(e.target.value as GroupKind | '')}
            >
              <option value="">{w.choose}</option>
              {GROUP_KINDS.map((g) => (
                <option key={g} value={g}>
                  {w[g]}
                </option>
              ))}
            </Select>
          )}
        </Field>
      ) : null}
      <fieldset style={{ border: 0, padding: 0, margin: 0, display: 'grid', gap: 'var(--s-2)' }}>
        <legend className="small">{w.activities}</legend>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--s-3)' }}>
          {ACTIVITIES.map((a) => (
            <Checkbox
              key={a}
              label={w[a]!}
              checked={activities.includes(a)}
              onChange={() => toggle(a)}
            />
          ))}
        </div>
      </fieldset>
      <div style={{ display: 'flex', gap: 'var(--s-3)', flexWrap: 'wrap' }}>
        <Button variant="primary" onClick={() => void save()} disabled={busy}>
          {busy ? w.saving : w.save}
        </Button>
        {next ? (
          <Button variant="ghost" onClick={() => window.location.assign(next)} disabled={busy}>
            {w.skip}
          </Button>
        ) : null}
      </div>
    </div>
  );
}
