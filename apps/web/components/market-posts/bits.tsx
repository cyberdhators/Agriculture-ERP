'use client';

import Link from 'next/link';
import { useId, useState, type ReactNode } from 'react';

import css from '@/components/account/settings.module.css';
import { Button, Select } from '@/components/ui';
import { t, type Language } from '@/lib/i18n';

import styles from './market-posts.module.css';

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

/**
 * 2026-10-31: an on/off setting inside a form card, drawn as the Account
 * page's switch row (components/account/settings.module.css). A native
 * checkbox underneath, so the form, the keyboard and the label behave as the
 * old tick box did.
 */
export function SwitchRow({
  label,
  hint,
  checked,
  disabled,
  onChange,
}: {
  label: string;
  hint?: string;
  checked: boolean;
  disabled?: boolean;
  onChange: (on: boolean) => void;
}) {
  return (
    <label className={`${css.row} ${styles.switchRow}`}>
      <span className={css.rowText}>
        <span className={css.rowLabel}>{label}</span>
        {hint ? <span className={css.rowHint}>{hint}</span> : null}
      </span>
      <input
        type="checkbox"
        role="switch"
        className={css.switch}
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
      />
    </label>
  );
}

/**
 * 2026-10-31 (the owner's phone screenshots: three dropdowns stacked under
 * the search): on a phone the search stays and the dropdowns fold behind a
 * "Filters" button, which counts the ones in use. On a wider screen the
 * button is hidden and the toolbar is the row it was. Presentation only --
 * the filters' values and handlers are the caller's, unchanged.
 */
export function FilterFold({
  lang,
  search,
  active,
  children,
}: {
  lang: Language;
  search: ReactNode;
  /** How many filters are set, shown on the button. */
  active: number;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const id = useId();
  return (
    <div className={styles.toolbar}>
      <div className={styles.searchRow}>
        {search}
        <Button
          variant="secondary"
          className={styles.filterToggle}
          aria-expanded={open}
          aria-controls={id}
          onClick={() => setOpen((o) => !o)}
        >
          {t('market.filters', lang)}
          {active > 0 ? <span className={styles.filterCount}>{active}</span> : null}
        </Button>
      </div>
      <div
        id={id}
        className={open ? styles.filterSet : `${styles.filterSet} ${styles.filterSetClosed}`}
      >
        {children}
      </div>
    </div>
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
