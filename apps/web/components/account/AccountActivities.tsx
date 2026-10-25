'use client';

import { useEffect, useState } from 'react';

import {
  ACTIVITIES,
  ENTERPRISE_SIZES,
  GROUP_KINDS,
  PROFILE_KINDS,
  accountProfileSchema,
  takesEnterpriseSize,
  type Activity,
  type EnterpriseSize,
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
    size: 'Size of the enterprise',
    sizeHint:
      'Optional. A size, not a kind of business: an SME can also be a trader, processor or supplier.',
    notStated: 'Not stated',
    micro: 'Micro',
    small: 'Small',
    medium: 'Medium',
    large: 'Large',
    showSize: 'Show the size on my public profile',
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
    size: 'حجم المنشأة',
    sizeHint:
      'اختياري. هو حجم وليس نوع نشاط: يمكن للمنشأة الصغيرة أو المتوسطة أن تكون تاجراً أو مُصنِّعاً أو مورداً أيضاً.',
    notStated: 'غير محدد',
    micro: 'متناهية الصغر',
    small: 'صغيرة',
    medium: 'متوسطة',
    large: 'كبيرة',
    showSize: 'اعرض الحجم في ملفي العام',
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
  // 2026-10-27: the enterprise size, separate from the activities ('' = not stated).
  const [size, setSize] = useState<EnterpriseSize | ''>('');
  const [showSize, setShowSize] = useState(false);
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
              enterprise_size?: EnterpriseSize | null;
              show_enterprise_size?: boolean;
            };
          } | null,
        ) => {
          if (!b?.data) return;
          setKind(b.data.profile_kind);
          setGroupKind(b.data.group_kind ?? '');
          setActivities(b.data.activities);
          setSize(b.data.enterprise_size ?? '');
          setShowSize(b.data.show_enterprise_size ?? false);
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
      ...(takesEnterpriseSize(kind)
        ? { enterprise_size: size || null, show_enterprise_size: showSize && size !== '' }
        : { enterprise_size: null, show_enterprise_size: false }),
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
      {takesEnterpriseSize(kind) ? (
        <>
          <Field label={w.size!} hint={w.sizeHint}>
            {(ids) => (
              <Select
                {...ids}
                value={size}
                onChange={(e) => setSize(e.target.value as EnterpriseSize | '')}
              >
                <option value="">{w.notStated}</option>
                {ENTERPRISE_SIZES.map((s) => (
                  <option key={s} value={s}>
                    {w[s]}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          {size ? (
            <Checkbox
              label={w.showSize!}
              checked={showSize}
              onChange={() => setShowSize((v) => !v)}
            />
          ) : null}
        </>
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
