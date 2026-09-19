'use client';

import Link from 'next/link';
import {
  forwardRef,
  useEffect,
  useId,
  useRef,
  useState,
  type ButtonHTMLAttributes,
  type InputHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
} from 'react';

import { IconInfo, IconSearch, IconWarn, IconCheck, IconX } from './icons';
import styles from './ui.module.css';

/**
 * The component set for "The Register". Near-square corners (2px controls, 4px
 * cards), structure carried by hairline rules rather than shadow, one amber
 * act per view, verification shown as an inked square stamp, sync as a small
 * mono chip, destructive actions outlined and never filled, every icon beside
 * a visible label, wells and skeletons in the dust tone and never text.
 *
 * The /design page renders each of these in every state.
 */

function cx(...names: Array<string | false | null | undefined>): string {
  return names.filter(Boolean).join(' ');
}

/* ---- Button ----------------------------------------------------------- */

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';

interface ButtonBaseProps {
  variant?: ButtonVariant;
  size?: 'default' | 'small';
  iconOnly?: boolean;
  children: ReactNode;
}

const variantClass: Record<ButtonVariant, string> = {
  primary: styles.buttonPrimary ?? '',
  secondary: styles.buttonSecondary ?? '',
  ghost: styles.buttonGhost ?? '',
  danger: styles.buttonDanger ?? '',
};

export const Button = forwardRef<
  HTMLButtonElement,
  ButtonBaseProps & ButtonHTMLAttributes<HTMLButtonElement>
>(function Button(
  { variant = 'primary', size = 'default', iconOnly = false, className, children, type, ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type ?? 'button'}
      className={cx(
        styles.button,
        variantClass[variant],
        size === 'small' && styles.buttonSmall,
        iconOnly && styles.buttonIconOnly,
        className,
      )}
      {...rest}
    >
      {children}
    </button>
  );
});

export function ButtonLink({
  href,
  variant = 'primary',
  size = 'default',
  className,
  children,
  ...rest
}: ButtonBaseProps & { href: string; className?: string; 'aria-current'?: 'page' }) {
  return (
    <Link
      href={href}
      className={cx(
        styles.button,
        variantClass[variant],
        size === 'small' && styles.buttonSmall,
        className,
      )}
      {...rest}
    >
      {children}
    </Link>
  );
}

/* ---- Badge ------------------------------------------------------------ */

export type Tone = 'leaf' | 'sorghum' | 'clay' | 'nile' | 'neutral';

const toneClass: Record<Tone, string> = {
  leaf: styles.badgeLeaf ?? '',
  sorghum: styles.badgeSorghum ?? '',
  clay: styles.badgeClay ?? '',
  nile: styles.badgeNile ?? '',
  neutral: styles.badgeNeutral ?? '',
};

export function Badge({
  tone = 'neutral',
  outline = false,
  dot = false,
  children,
  className,
}: {
  tone?: Tone;
  outline?: boolean;
  dot?: boolean;
  children: ReactNode;
  className?: string;
}) {
  return (
    <span
      className={cx(
        styles.badge,
        toneClass[tone],
        outline && styles.badgeOutline,
        dot && styles.badgeDot,
        className,
      )}
    >
      {children}
    </span>
  );
}

/* ---- Stamp (verification / record status) ---------------------------- */

export type StampKind =
  'verified' | 'pending' | 'rejected' | 'merged' | 'info' | 'escalated' | 'neutral';

const stampClass: Record<StampKind, string> = {
  verified: styles.stampVerified ?? '',
  pending: styles.stampPending ?? '',
  rejected: styles.stampRejected ?? '',
  merged: styles.stampMerged ?? '',
  info: styles.stampInfo ?? '',
  escalated: styles.stampEscalated ?? '',
  neutral: styles.stampNeutral ?? '',
};

/** An inked, square status stamp. The word carries the meaning; colour backs it. */
export function Stamp({
  kind = 'neutral',
  children,
  className,
}: {
  kind?: StampKind;
  children: ReactNode;
  className?: string;
}) {
  return <span className={cx(styles.stamp, stampClass[kind], className)}>{children}</span>;
}

/* ---- Sync chip -------------------------------------------------------- */

export type SyncStatus = 'waiting' | 'sending' | 'synced' | 'failed';

const syncClass: Record<SyncStatus, string> = {
  waiting: styles.syncWaiting ?? '',
  sending: styles.syncSending ?? '',
  synced: styles.syncSynced ?? '',
  failed: styles.syncFailed ?? '',
};

const SYNC_LABELS: Record<SyncStatus, string> = {
  waiting: 'waiting',
  sending: 'sending',
  synced: 'synced',
  failed: 'failed',
};

/** The offline spine, shown small: a dot and the per-device sync state. */
export function SyncChip({ status }: { status: SyncStatus }) {
  return (
    <span className={cx(styles.syncChip, syncClass[status])}>
      <span className={styles.syncDot} aria-hidden />
      {SYNC_LABELS[status]}
    </span>
  );
}

/* ---- KPI strip -------------------------------------------------------- */

export interface KpiItem {
  label: string;
  value: ReactNode;
  delta?: ReactNode;
  accent?: boolean;
}

/** A hairline-ruled row of Fraunces figures with mono deltas — not cards. */
export function KpiStrip({ items, label }: { items: ReadonlyArray<KpiItem>; label: string }) {
  return (
    <div className={styles.kpiStrip} role="group" aria-label={label}>
      {items.map((item) => (
        <div key={item.label} className={styles.kpiItem}>
          <span className={cx(styles.kpiValue, item.accent && styles.kpiValueAccent)}>
            {item.value}
          </span>
          <span className={styles.kpiLabel}>{item.label}</span>
          {item.delta !== undefined ? <span className={styles.kpiDelta}>{item.delta}</span> : null}
        </div>
      ))}
    </div>
  );
}

/* ---- Card ------------------------------------------------------------- */

export function Card({
  children,
  className,
  padded = false,
  as: Tag = 'section',
  ...rest
}: {
  children: ReactNode;
  className?: string;
  padded?: boolean;
  as?: 'section' | 'article' | 'div' | 'aside';
  'aria-labelledby'?: string;
  'aria-label'?: string;
  id?: string;
}) {
  return (
    <Tag
      className={cx(styles.card, padded && styles.cardPadded, 'print-flat', className)}
      {...rest}
    >
      {children}
    </Tag>
  );
}

export function CardHeader({
  title,
  subtitle,
  actions,
  id,
}: {
  title: ReactNode;
  subtitle?: ReactNode;
  actions?: ReactNode;
  id?: string;
}) {
  return (
    <header className={styles.cardHeader}>
      <div className={styles.cardHeaderText}>
        <h2 id={id}>{title}</h2>
        {subtitle ? <p className="small muted">{subtitle}</p> : null}
      </div>
      {actions ? <div className={cx(styles.pageActions, 'no-print')}>{actions}</div> : null}
    </header>
  );
}

export function CardBody({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cx(styles.cardBody, className)}>{children}</div>;
}

export function CardFooter({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cx(styles.cardFooter, className)}>{children}</div>;
}

/* ---- Field + controls ------------------------------------------------- */

interface FieldProps {
  label: string;
  hint?: string;
  error?: string | undefined;
  optional?: boolean;
  children: (ids: {
    id: string;
    'aria-describedby': string | undefined;
    'aria-invalid': true | undefined;
  }) => ReactNode;
}

/**
 * Label, control, hint and error in one accessible group. The child gets the
 * ids to wire itself up; the error text comes straight from the shared Zod
 * schema so the form says exactly what the API would say.
 */
export function Field({ label, hint, error, optional, children }: FieldProps) {
  const id = useId();
  const hintId = `${id}-hint`;
  const errorId = `${id}-error`;
  const describedBy = [hint ? hintId : null, error ? errorId : null].filter(Boolean).join(' ');
  return (
    <div className={styles.field}>
      <label className={styles.fieldLabel} htmlFor={id}>
        {label}
        {optional ? <span className={styles.fieldOptional}>optional</span> : null}
      </label>
      {children({
        id,
        'aria-describedby': describedBy || undefined,
        'aria-invalid': error ? true : undefined,
      })}
      {hint ? (
        <p id={hintId} className={styles.fieldHint}>
          {hint}
        </p>
      ) : null}
      {error ? (
        <p id={errorId} className={styles.fieldError} role="alert">
          <IconWarn size={16} />
          <span>{error}</span>
        </p>
      ) : null}
    </div>
  );
}

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(
  function Input({ className, ...rest }, ref) {
    return <input ref={ref} className={cx(styles.control, className)} {...rest} />;
  },
);

export const Select = forwardRef<HTMLSelectElement, SelectHTMLAttributes<HTMLSelectElement>>(
  function Select({ className, ...rest }, ref) {
    return <select ref={ref} className={cx(styles.control, className)} {...rest} />;
  },
);

export const Textarea = forwardRef<
  HTMLTextAreaElement,
  TextareaHTMLAttributes<HTMLTextAreaElement>
>(function Textarea({ className, ...rest }, ref) {
  return <textarea ref={ref} className={cx(styles.control, className)} {...rest} />;
});

export function PrefixedInput({
  prefix,
  ...rest
}: { prefix: string } & InputHTMLAttributes<HTMLInputElement>) {
  return (
    <div className={styles.controlWithPrefix}>
      <span className={styles.controlPrefix} aria-hidden="true">
        {prefix}
      </span>
      <Input {...rest} />
    </div>
  );
}

/**
 * A password control with a visible "Show" / "Hide" word (never an icon alone).
 * The caller passes the two words so the farmer flow can render them in the
 * chosen language; the staff portal passes the English defaults.
 */
export function PasswordInput({
  showLabel = 'Show',
  hideLabel = 'Hide',
  ...rest
}: { showLabel?: string; hideLabel?: string } & InputHTMLAttributes<HTMLInputElement>) {
  const [visible, setVisible] = useState(false);
  return (
    <div className={styles.controlWithToggle}>
      <Input type={visible ? 'text' : 'password'} {...rest} />
      <button
        type="button"
        className={styles.controlToggle}
        aria-pressed={visible}
        onClick={() => setVisible((v) => !v)}
      >
        {visible ? hideLabel : showLabel}
      </button>
    </div>
  );
}

/**
 * `labelHidden` keeps the label for a screen reader and takes it off the
 * screen — for a checkbox in a table row, where the visible column heading
 * already says what the column is but "Select" repeated down forty rows tells
 * a screen-reader user nothing about WHICH row they are on. The label still
 * names the farmer; it is simply not drawn.
 */
export function Checkbox({
  label,
  labelHidden = false,
  ...rest
}: { label: ReactNode; labelHidden?: boolean } & InputHTMLAttributes<HTMLInputElement>) {
  return (
    <label className={styles.checkbox}>
      <input type="checkbox" {...rest} />
      <span className={labelHidden ? 'visually-hidden' : undefined}>{label}</span>
    </label>
  );
}

export function SearchInput({
  label,
  ...rest
}: { label: string } & InputHTMLAttributes<HTMLInputElement>) {
  const id = useId();
  return (
    <div className={styles.search}>
      <label htmlFor={id} className="visually-hidden">
        {label}
      </label>
      <IconSearch size={18} />
      <Input id={id} type="search" {...rest} />
    </div>
  );
}

/* ---- Tabs ------------------------------------------------------------- */

export interface TabItem<K extends string> {
  key: K;
  label: string;
  count?: number;
}

export function Tabs<K extends string>({
  label,
  items,
  value,
  onChange,
}: {
  label: string;
  items: ReadonlyArray<TabItem<K>>;
  value: K;
  onChange: (key: K) => void;
}) {
  return (
    <div className={styles.tabs} role="tablist" aria-label={label}>
      {items.map((item) => (
        <button
          key={item.key}
          type="button"
          role="tab"
          aria-selected={item.key === value}
          tabIndex={item.key === value ? 0 : -1}
          className={styles.tab}
          onClick={() => onChange(item.key)}
          onKeyDown={(event) => {
            const index = items.findIndex((i) => i.key === value);
            if (event.key === 'ArrowRight') onChange(items[(index + 1) % items.length]!.key);
            if (event.key === 'ArrowLeft')
              onChange(items[(index - 1 + items.length) % items.length]!.key);
          }}
        >
          {item.label}
          {item.count !== undefined ? <span className={styles.tabCount}>{item.count}</span> : null}
        </button>
      ))}
    </div>
  );
}

/* ---- Empty / error state --------------------------------------------- */

/**
 * The design rule for empty and error states: say what happened and what to
 * do next, in that order, with the next step as a real button or link.
 */
export function EmptyState({
  title,
  body,
  actions,
  error = false,
  icon,
}: {
  title: string;
  body: ReactNode;
  actions?: ReactNode;
  error?: boolean;
  icon?: ReactNode;
}) {
  return (
    <div className={cx(styles.state, error && styles.stateError)} role={error ? 'alert' : 'status'}>
      <div className={styles.stateIcon}>
        {icon ?? (error ? <IconWarn size={22} /> : <IconSearch size={22} />)}
      </div>
      <div>
        <p className={styles.stateTitle}>{title}</p>
        <p className={styles.stateBody}>{body}</p>
        {actions ? <div className={cx(styles.stateActions, 'no-print')}>{actions}</div> : null}
      </div>
    </div>
  );
}

/* ---- Notice ----------------------------------------------------------- */

export type NoticeKind = 'info' | 'success' | 'warn' | 'error';

const noticeClass: Record<NoticeKind, string> = {
  info: styles.noticeInfo ?? '',
  success: styles.noticeSuccess ?? '',
  warn: styles.noticeWarn ?? '',
  error: styles.noticeError ?? '',
};

const noticeIcon: Record<NoticeKind, ReactNode> = {
  info: <IconInfo size={20} />,
  success: <IconCheck size={20} />,
  warn: <IconWarn size={20} />,
  error: <IconX size={20} />,
};

export function Notice({
  kind = 'info',
  title,
  children,
  className,
}: {
  kind?: NoticeKind;
  title?: string;
  children?: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cx(styles.notice, noticeClass[kind], className)}
      role={kind === 'error' ? 'alert' : 'status'}
    >
      {noticeIcon[kind]}
      <div>
        {title ? <p className={styles.noticeTitle}>{title}</p> : null}
        {children ? <div className={styles.noticeBody}>{children}</div> : null}
      </div>
    </div>
  );
}

/* ---- Skeleton --------------------------------------------------------- */

export function Skeleton({
  width = '100%',
  height = 16,
  className,
}: {
  width?: string | number;
  height?: string | number;
  className?: string;
}) {
  return <span className={cx(styles.skeleton, className)} style={{ width, height }} aria-hidden />;
}

/* ---- Dialog ----------------------------------------------------------- */

/**
 * Native <dialog>: focus trapping, Escape and the backdrop come from the
 * browser. Confirmation dialogs for destructive actions include a reason
 * field (design rule); the caller renders it in `children`.
 */
export function Dialog({
  open,
  onClose,
  title,
  children,
  footer,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  footer: ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  return (
    <dialog ref={ref} className={styles.dialog} aria-labelledby={titleId} onClose={onClose}>
      <div className={styles.dialogHeader}>
        <h2 id={titleId}>{title}</h2>
      </div>
      <div className={styles.dialogBody}>{children}</div>
      <div className={styles.dialogFooter}>{footer}</div>
    </dialog>
  );
}

/* ---- Definition list -------------------------------------------------- */

export function DefinitionList({
  items,
}: {
  items: ReadonlyArray<{ term: string; value: ReactNode }>;
}) {
  return (
    <dl className={styles.dl}>
      {items.map((item) => (
        <div key={item.term} style={{ display: 'contents' }}>
          <dt>{item.term}</dt>
          <dd>{item.value}</dd>
        </div>
      ))}
    </dl>
  );
}

/* ---- Page header ----------------------------------------------------- */

export function PageHeader({
  eyebrow,
  title,
  subtitle,
  actions,
}: {
  eyebrow?: string;
  title: string;
  subtitle?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <div className={styles.pageHeader}>
      <div className={styles.pageHeaderText}>
        {eyebrow ? <p className={styles.pageEyebrow}>{eyebrow}</p> : null}
        <h1>{title}</h1>
        {subtitle ? <p className={styles.pageSubtitle}>{subtitle}</p> : null}
      </div>
      {actions ? <div className={cx(styles.pageActions, 'no-print')}>{actions}</div> : null}
    </div>
  );
}

/* ---- Avatar + chips --------------------------------------------------- */

export function Avatar({
  text,
  tone = 'neutral',
  large = false,
}: {
  text: string;
  tone?: 'neutral' | 'leaf' | 'nile' | 'sorghum';
  large?: boolean;
}) {
  const toneMap = {
    neutral: '',
    leaf: styles.avatarLeaf,
    nile: styles.avatarNile,
    sorghum: styles.avatarSorghum,
  };
  return (
    <span className={cx(styles.avatar, large && styles.avatarLarge, toneMap[tone])} aria-hidden>
      {text}
    </span>
  );
}

export function Chips({ items, dir }: { items: readonly string[]; dir?: 'auto' }) {
  return (
    <ul className={styles.chips}>
      {items.map((item) => (
        <li key={item} className={styles.chip} dir={dir}>
          {item}
        </li>
      ))}
    </ul>
  );
}
