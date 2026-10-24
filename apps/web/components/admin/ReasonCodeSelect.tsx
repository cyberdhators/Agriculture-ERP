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
/*
 * 2026-10-26 (CORWADO's acceptance test): the list arrived after the dialog
 * did, so a suspension could be confirmed before its code could be chosen.
 * The list is now loaded ONCE per kind of decision and kept for the page's
 * life: a dialog opened again shows it at once, and a screen can preload it
 * when it mounts (useReasonCodes) and keep its confirm button disabled while
 * `loading` is true. A list that cannot be read is forgotten, so the next
 * dialog asks again; meanwhile the dialog works as it did before codes existed.
 */
const loaded = new Map<ReasonTarget, Code[]>();
const pending = new Map<ReasonTarget, Promise<Code[] | null>>();

export function loadReasonCodes(target: ReasonTarget): Promise<Code[] | null> {
  const known = loaded.get(target);
  if (known) return Promise.resolve(known);
  let request = pending.get(target);
  if (!request) {
    request = fetch(`/api/admin/reason-codes?applies_to=${target}`)
      .then(async (res) => {
        if (!res.ok) return null;
        const body = (await res.json().catch(() => ({}))) as { data?: Code[] };
        return body.data ?? null;
      })
      .catch(() => null)
      .then((list) => {
        pending.delete(target);
        if (list) loaded.set(target, list);
        return list;
      });
    pending.set(target, request);
  }
  return request;
}

/** The codes for one kind of decision, and whether they are still being read. */
export function useReasonCodes(target: ReasonTarget): { codes: Code[] | null; loading: boolean } {
  const [state, setState] = useState<{ codes: Code[] | null; loading: boolean }>(() => {
    const known = loaded.get(target);
    return known ? { codes: known, loading: false } : { codes: null, loading: true };
  });
  useEffect(() => {
    let live = true;
    void loadReasonCodes(target).then((list) => {
      if (live) setState({ codes: list, loading: false });
    });
    return () => {
      live = false;
    };
  }, [target]);
  return state;
}

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
  const { codes, loading } = useReasonCodes(target);

  if (loading) {
    return (
      <p className="small muted" role="status">
        Loading reason codes…
      </p>
    );
  }
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
