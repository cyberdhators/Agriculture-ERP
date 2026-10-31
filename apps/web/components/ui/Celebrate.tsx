import type { ReactNode } from 'react';

import { Illustration, type IllustrationKey } from './illustrations';
import styles from './celebrate.module.css';

/**
 * A small moment of celebration (2026-10-31): after signing up, or after a
 * listing goes on the market. A drawing that pops in once over a soft glow,
 * one line, and the obvious next step. The pop is off under reduced motion.
 */
export function Celebrate({
  art,
  title,
  body,
  children,
  compact = false,
}: {
  art: IllustrationKey;
  title: ReactNode;
  body?: ReactNode;
  /** The next step (a button or two). */
  children?: ReactNode;
  /** A card inside a page, rather than a page of its own. */
  compact?: boolean;
}) {
  const Art = Illustration[art];
  return (
    <section className={compact ? `${styles.celebrate} ${styles.compact}` : styles.celebrate}>
      <span className={styles.glow} aria-hidden>
        <Art size={compact ? 72 : 112} />
      </span>
      <h2 className={styles.title}>{title}</h2>
      {body ? <p className={styles.body}>{body}</p> : null}
      {children ? <div className={styles.actions}>{children}</div> : null}
    </section>
  );
}
