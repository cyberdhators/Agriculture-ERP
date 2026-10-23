'use client';

import { useEffect, useState } from 'react';

import type { ReasonTarget } from '@agri-erp/shared';

import { Field, Select } from '../ui';

interface Code {
  code: string;
  label: string;
}

/**
 * MODERATION REASON CODES (2026-10-25, settings phase 1). A dropdown of the
 * active codes for one kind of decision, as CORWADO keeps them in Settings ->
 * Moderation reason codes (GET /api/admin/reason-codes). Choosing one
 * PRE-FILLS the written reason, which the moderator may then edit; the written
 * reason stays required wherever it was required before.
 *
 * If the list cannot be read, nothing is shown and the dialog works exactly as
 * it did before codes existed.
 */
export function ReasonCodeSelect({
  target,
  value,
  onPick,
}: {
  target: ReasonTarget;
  value: string;
  /** The chosen code ('' for none) and its label, to pre-fill the reason with. */
  onPick: (code: string, label: string) => void;
}) {
  const [codes, setCodes] = useState<Code[] | null>(null);

  useEffect(() => {
    let live = true;
    fetch(`/api/admin/reason-codes?applies_to=${target}`)
      .then(async (res) => {
        if (!res.ok) return null;
        const body = (await res.json().catch(() => ({}))) as { data?: Code[] };
        return body.data ?? null;
      })
      .catch(() => null)
      .then((list) => {
        if (live) setCodes(list);
      });
    return () => {
      live = false;
    };
  }, [target]);

  if (!codes || codes.length === 0) return null;

  return (
    <Field label="Reason code" hint="Pre-fills the reason below, which you can then edit." optional>
      {(ids) => (
        <Select
          {...ids}
          value={value}
          onChange={(e) => {
            const picked = codes.find((c) => c.code === e.target.value);
            onPick(picked?.code ?? '', picked?.label ?? '');
          }}
        >
          <option value="">Choose a reason code</option>
          {codes.map((c) => (
            <option key={c.code} value={c.code}>
              {c.label}
            </option>
          ))}
        </Select>
      )}
    </Field>
  );
}
