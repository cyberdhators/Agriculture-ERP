'use client';

import Link from 'next/link';

import { Select } from '@/components/ui';

/** A filter: a labelled select whose first choice is "any". */
export function SearchSelect({
  label,
  value,
  onChange,
  options,
  anyLabel,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: ReadonlyArray<{ value: string; label: string }>;
  anyLabel: string;
}) {
  return (
    <Select aria-label={label} value={value} onChange={(e) => onChange(e.target.value)}>
      <option value="">{anyLabel}</option>
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </Select>
  );
}

/** "← Back to …" above a detail page. */
export function BackLinkRow({ href, label }: { href: string; label: string }) {
  return (
    <p className="small">
      <Link href={href}>← {label}</Link>
    </p>
  );
}
