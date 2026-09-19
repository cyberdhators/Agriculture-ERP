import Link from 'next/link';

import styles from './admin.module.css';

/** Inline glyphs, so the hub needs no icon library (design law: SVG only). */
function Glyph({
  kind,
}: {
  kind: 'users' | 'audit' | 'coverage' | 'verify' | 'reference' | 'export';
}) {
  const common = {
    width: 22,
    height: 22,
    viewBox: '0 0 24 24',
    fill: 'none',
    'aria-hidden': true,
  } as const;
  const stroke = {
    stroke: 'currentColor',
    strokeWidth: 1.6,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
  };
  switch (kind) {
    case 'users':
      return (
        <svg {...common}>
          <circle cx="9" cy="8" r="3" {...stroke} />
          <path d="M4 19c0-2.8 2.2-5 5-5s5 2.2 5 5" {...stroke} />
          <path d="M16 6a3 3 0 0 1 0 6M20 19c0-2.2-1.2-4-3-4.7" {...stroke} />
        </svg>
      );
    case 'audit':
      return (
        <svg {...common}>
          <path d="M6 3h9l4 4v14H6z" {...stroke} />
          <path d="M14 3v4h4M9 12h7M9 16h7M9 8h2" {...stroke} />
        </svg>
      );
    case 'coverage':
      return (
        <svg {...common}>
          <path d="M12 21s7-5.5 7-11a7 7 0 1 0-14 0c0 5.5 7 11 7 11z" {...stroke} />
          <circle cx="12" cy="10" r="2.4" {...stroke} />
        </svg>
      );
    case 'verify':
      return (
        <svg {...common}>
          <path d="M12 3l7 3v5c0 4.5-3 7.5-7 9-4-1.5-7-4.5-7-9V6z" {...stroke} />
          <path d="M9 12l2 2 4-4" {...stroke} />
        </svg>
      );
    case 'export':
      return (
        <svg {...common}>
          <path d="M12 3v11M8 10l4 4 4-4" {...stroke} />
          <path d="M5 20h14" {...stroke} />
        </svg>
      );
    case 'reference':
      return (
        <svg {...common}>
          <path d="M5 5h14v14H5z" {...stroke} />
          <path d="M5 9h14M9 9v10" {...stroke} />
        </svg>
      );
  }
}

const CARDS = [
  {
    href: '/admin/users',
    glyph: 'users' as const,
    title: 'Users & officers',
    body: 'Create, edit and deactivate staff accounts and extension officers; reset passwords.',
  },
  {
    href: '/admin/audit',
    glyph: 'audit' as const,
    title: 'Audit trail',
    body: 'Who created, changed or deactivated what, across the whole system. Append-only.',
  },
];

/*
 * COMING LATER MUST STAY TRUE AS THINGS LAND.
 *
 * Two entries were removed here on 2026-09-18 because they had been built and
 * this card was still calling them future: "Coverage & reporting — Phase 7" is
 * now `/reports`, and "Verification oversight — Needs B6" is now the review
 * queue at `/farmers/review`. Both are in the sidebar. A screen that describes
 * a shipped capability as unbuilt is worse than one that says nothing, because
 * a reader trusts it and stops looking.
 */
const PLANNED = [
  {
    glyph: 'reference' as const,
    title: 'Reference data',
    body: 'The state → county → payam hierarchy and other lists the system is scoped by.',
    when: 'On the I-07 lists',
  },
];

/**
 * The administration landing. An administrator does more than manage accounts:
 * this is the hub for everything only they may do. What is backed by a live
 * route today links out; what a later phase brings is shown, greyed, so the
 * remit is legible without pretending it is built.
 */
export function AdminHub() {
  return (
    <div className={styles.page}>
      <header className={styles.head}>
        <p className={styles.eyebrow}>Administration</p>
        <h1 className={styles.h1}>Administration</h1>
        <p className={styles.lede}>
          Everything reserved to an administrator: the people who use the system, the record of what
          they did and, as later phases land, coverage, verification oversight and reference data.
        </p>
      </header>

      <div className={styles.hubGrid}>
        {CARDS.map((c) => (
          <Link key={c.href} href={c.href} className={styles.hubCard}>
            <span className={styles.hubGlyph}>
              <Glyph kind={c.glyph} />
            </span>
            <span className={styles.hubTitle}>{c.title}</span>
            <span className={styles.hubBody}>{c.body}</span>
          </Link>
        ))}
      </div>

      <div className={styles.sectionHead} style={{ marginTop: 'var(--s-8)' }}>
        <h2>Coming with later phases</h2>
      </div>
      <div className={styles.hubGrid}>
        {PLANNED.map((c) => (
          <div key={c.title} className={`${styles.hubCard} ${styles.hubCardMuted}`}>
            <span className={styles.hubGlyph}>
              <Glyph kind={c.glyph} />
            </span>
            <span className={styles.hubTitle}>
              {c.title} <span className={styles.hubWhen}>{c.when}</span>
            </span>
            <span className={styles.hubBody}>{c.body}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
