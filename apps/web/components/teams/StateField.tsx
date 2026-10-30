'use client';

import { useEffect, useState } from 'react';

import { Field, Select } from '@/components/ui';
import { listStates } from '@/lib/market-posts/api';

/**
 * 2026-10-28 (user journeys, team access follow-up): the organisation's
 * state, from the state list (organization.state_id; the route checks it
 * against the list). Optional: "Not stated" sends null. Shown on the public
 * organisation page beside the general location.
 */
const WORDS = {
  en: { label: 'State or area', none: 'Not stated' },
  ar: { label: 'الولاية أو المنطقة', none: 'غير محدد' },
} as const;

export function OrganisationStateField({
  language,
  value,
  onChange,
  error,
}: {
  language: 'en' | 'ar';
  value: string;
  onChange: (stateId: string) => void;
  error?: string;
}) {
  const w = WORDS[language];
  const [states, setStates] = useState<{ id: string; name: string }[]>([]);

  useEffect(() => {
    listStates()
      .then(setStates)
      .catch(() => setStates([]));
  }, []);

  return (
    <Field label={w.label} error={error} optional>
      {(ids) => (
        <Select {...ids} value={value} onChange={(e) => onChange(e.target.value)}>
          <option value="">{w.none}</option>
          {states.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </Select>
      )}
    </Field>
  );
}
