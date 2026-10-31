import type { ReactNode, SVGProps } from 'react';

/**
 * 2026-10-31 (the owner: "make it come alive"): small, warm line drawings for
 * empty pages. Same language as the quick-action glyphs -- a soft filled shape
 * under a clean outline -- drawn larger (96 grid) with one gentle accent.
 * Colours are currentColor and CSS variables only, so they follow a future
 * dark mode. Decorative: the EmptyState title carries the meaning.
 */

export type IllustrationProps = SVGProps<SVGSVGElement> & { size?: number };

/** The soft fill under each outline. */
const SOFT = { fill: 'currentColor', fillOpacity: 0.16, stroke: 'none' } as const;
/** A warm accent (produce, a spark), filled only; `style` so var() resolves. */
const WARM = { style: { fill: 'var(--harvest)' }, stroke: 'none' } as const;
/** A green accent (leaves), filled only. */
const LEAF = { style: { fill: 'var(--sprout)' }, stroke: 'none' } as const;

function Art({ size = 96, children, ...rest }: IllustrationProps & { children: ReactNode }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 96 96"
      fill="none"
      stroke="currentColor"
      strokeWidth={2.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      {...rest}
    >
      {/* A faint ground line, the same under every drawing. */}
      <path d="M18 84h60" strokeOpacity={0.3} />
      {children}
    </svg>
  );
}

export const ArtBasket = (p: IllustrationProps) => (
  <Art {...p}>
    <circle {...WARM} cx="38" cy="44" r="8" fillOpacity={0.85} />
    <circle {...LEAF} cx="54" cy="42" r="7" fillOpacity={0.85} />
    <path {...SOFT} d="M16 50h64l-7 30H23z" />
    <path d="M30 50c0-12 8-20 18-20s18 8 18 20" />
    <path d="M14 50h68M16 50l7 30h50l7-30M36 58l2 14M48 58v14M60 58l-2 14" />
  </Art>
);

export const ArtChat = (p: IllustrationProps) => (
  <Art {...p}>
    <path
      {...SOFT}
      d="M14 22h44a6 6 0 0 1 6 6v20a6 6 0 0 1-6 6H32l-10 9v-9h-8a6 6 0 0 1-6-6V28a6 6 0 0 1 6-6z"
    />
    <path d="M14 22h44a6 6 0 0 1 6 6v20a6 6 0 0 1-6 6H32l-10 9v-9h-8a6 6 0 0 1-6-6V28a6 6 0 0 1 6-6z" />
    <path d="M70 36h6a6 6 0 0 1 6 6v18a6 6 0 0 1-6 6h-4v8l-9-8H50a6 6 0 0 1-6-6v-2" />
    <circle {...WARM} cx="26" cy="38" r="2.5" />
    <circle {...WARM} cx="36" cy="38" r="2.5" />
    <circle {...WARM} cx="46" cy="38" r="2.5" />
  </Art>
);

export const ArtBox = (p: IllustrationProps) => (
  <Art {...p}>
    <path {...SOFT} d="M18 36l30-12 30 12v34L48 82 18 70z" />
    <path d="M18 36l30-12 30 12v34L48 82 18 70zM18 36l30 12 30-12M48 48v34" />
    <path {...WARM} d="M30 31.2l6-2.4 30 12-6 2.4z" fillOpacity={0.9} />
  </Art>
);

export const ArtCart = (p: IllustrationProps) => (
  <Art {...p}>
    <path {...SOFT} d="M26 30h56l-8 28H32z" />
    <path d="M8 18h10l10 44h44M26 30h56l-8 28H32" />
    <circle cx="36" cy="74" r="5" />
    <circle cx="66" cy="74" r="5" />
    <path {...LEAF} d="M50 22c6-8 14-8 18-6-2 6-10 10-18 6z" fillOpacity={0.85} />
  </Art>
);

export const ArtBell = (p: IllustrationProps) => (
  <Art {...p}>
    <path {...SOFT} d="M28 62V44a20 20 0 0 1 40 0v18l6 8H22z" />
    <path d="M28 62V44a20 20 0 0 1 40 0v18l6 8H22zM48 16v8" />
    <path {...WARM} d="M41 74a7 7 0 0 0 14 0z" />
    <path d="M41 74a7 7 0 0 0 14 0" />
    <path d="M76 30c3 4 4 8 4 12M20 30c-3 4-4 8-4 12" strokeOpacity={0.5} />
  </Art>
);

export const ArtField = (p: IllustrationProps) => (
  <Art {...p}>
    <path {...SOFT} d="M12 76l14-36h44l14 36z" />
    <path d="M12 76l14-36h44l14 36zM48 40v36M19 58h58M34 40l-6 36M62 40l6 36" />
    <circle {...WARM} cx="70" cy="20" r="7" fillOpacity={0.9} />
    <path {...LEAF} d="M40 30c0-6 4-10 8-10 0 6-4 10-8 10zM56 30c0-6-4-10-8-10 0 6 4 10 8 10z" />
  </Art>
);

export const ArtMagnifier = (p: IllustrationProps) => (
  <Art {...p}>
    <circle {...SOFT} cx="42" cy="42" r="20" />
    <circle cx="42" cy="42" r="20" />
    <path d="M57 57l17 17" strokeWidth={5} />
    <path d="M32 36a12 12 0 0 1 10-6" strokeOpacity={0.6} />
    <circle {...WARM} cx="74" cy="22" r="3" />
    <circle {...LEAF} cx="18" cy="70" r="2.5" />
  </Art>
);

export const ArtDocument = (p: IllustrationProps) => (
  <Art {...p}>
    <path {...SOFT} d="M26 12h30l14 14v52H26z" />
    <path d="M26 12h30l14 14v52H26zM56 12v14h14M36 40h24M36 50h24M36 60h14" />
    <circle {...WARM} cx="66" cy="68" r="10" fillOpacity={0.9} />
    <path d="M61 68l4 4 7-8" style={{ stroke: 'var(--card)' }} />
  </Art>
);

export const ArtSeedling = (p: IllustrationProps) => (
  <Art {...p}>
    <path {...SOFT} d="M30 66h36l-4 18H34z" />
    <path d="M28 66h40M30 66l4 18h28l4-18M48 66V42" />
    <path {...LEAF} d="M48 46c-14 0-20-8-20-18 12 0 20 6 20 18z" />
    <path d="M48 46c-14 0-20-8-20-18 12 0 20 6 20 18z" />
    <path {...LEAF} d="M48 40c0-12 8-20 22-20 0 12-8 20-22 20z" fillOpacity={0.7} />
    <path d="M48 40c0-12 8-20 22-20 0 12-8 20-22 20z" />
  </Art>
);

export const Illustration = {
  basket: ArtBasket,
  chat: ArtChat,
  box: ArtBox,
  cart: ArtCart,
  bell: ArtBell,
  field: ArtField,
  magnifier: ArtMagnifier,
  document: ArtDocument,
  seedling: ArtSeedling,
} as const;

export type IllustrationKey = keyof typeof Illustration;
