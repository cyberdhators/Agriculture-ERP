import type { ListingCategory } from '@/lib/fixtures/farmers';

/**
 * 2026-10-31: the no-photo illustration, one flat line drawing per listing
 * category — a maize cob, a tomato, a mango, a cow, a hen, a milk can, a
 * fish, a sack, a seedling and a basket for "other". Drawn on a 64 grid in
 * `currentColor` only (a soft fill at low opacity plus a line), so the
 * placeholder tints it from the tokens and it follows any future dark mode.
 * Decorative: the frame around it carries the accessible name.
 */
type Art = {
  /** The body, drawn with a soft fill and the outline. */
  body: string;
  /** Detail lines on top, outline only. */
  lines: string;
};

const ART: Record<ListingCategory, Art> = {
  crop: {
    body: 'M32 10c6 0 9 8 9 20s-3 22-9 22-9-10-9-22 3-20 9-20Z',
    lines:
      'M24.5 22h15M23.5 30h17M24 38h16M26 45h12M32 11v40M23 34c-6 4-9 12-8 20 6-2 11-6 14-12M41 34c6 4 9 12 8 20-6-2-11-6-14-12M32 52v5',
  },
  vegetable: {
    body: 'M32 22c11 0 18 7 18 16s-8 16-18 16-18-7-18-16 7-16 18-16Z',
    lines: 'M32 22l-6-5M32 22l6-5M32 22l-9 1M32 22l9 1M32 22v-10M21 35c1-3 3-5 6-6',
  },
  fruit: {
    body: 'M22 18c10-6 26 2 28 16s-8 22-18 20S12 44 14 32c1-6 4-11 8-14Z',
    lines: 'M30 16c1-4 3-6 6-7M36 9c6-2 12 0 14 4-6 3-11 2-14-4ZM20 30c1-4 3-7 6-8',
  },
  livestock: {
    body: 'M22 22h20v16c0 8-4 14-10 14s-10-6-10-14V22Z',
    lines:
      'M22 22c-4 0-7-3-8-7M42 22c4 0 7-3 8-7M22 26c-4 0-7 1-9 3 2 2 5 3 9 2M42 26c4 0 7 1 9 3-2 2-5 3-9 2M25 43h14M28 47h.01M36 47h.01M27 32h.01M37 32h.01',
  },
  poultry: {
    body: 'M24 24c5 2 8 5 8 8h8l10-8c1 12-4 26-18 26-10 0-16-6-16-14 0-6 3-10 8-12Z',
    lines:
      'M30 18a6 6 0 1 1-12 0 6 6 0 0 1 12 0ZM20 12c1-3 3-4 4-3 1-2 3-2 4 0 2-1 3 1 2 3M18 18l-4 2 4 2M22 17h.01M26 38c4 4 10 4 14 0M30 52v6M36 52v6',
  },
  dairy: {
    body: 'M24 14h16v6l4 6v26a4 4 0 0 1-4 4H24a4 4 0 0 1-4-4V26l4-6v-6Z',
    lines:
      'M22 10h20v4H22ZM20 32h24M20 28c-4 0-6 2-6 5s2 5 6 5M44 28c4 0 6 2 6 5s-2 5-6 5M32 39c-2 3-3 5-3 6a3 3 0 0 0 6 0c0-1-1-3-3-6Z',
  },
  fish: {
    body: 'M8 32c6-9 15-13 24-13 8 0 14 5 18 13-4 8-10 13-18 13-9 0-18-4-24-13Z',
    lines:
      'M50 32l8-9v18l-8-9ZM22 23c3 5 3 13 0 18M15 30h.01M33 26c-2 4-2 8 0 12M41 27c-2 3-2 7 0 10',
  },
  processed: {
    body: 'M22 16c-6 8-10 18-10 26 0 8 6 12 20 12s20-4 20-12c0-8-4-18-10-26Z',
    lines: 'M22 16h20M24 16l-3-7h22l-3 7M25 32h14v10H25Z',
  },
  seeds_inputs: {
    body: 'M12 52c6-4 14-6 20-6s14 2 20 6Z',
    lines: 'M32 46V24M32 34c-10 0-16-6-16-14 10 0 16 6 16 14ZM32 28c0-8 6-14 16-14 0 8-6 14-16 14Z',
  },
  other: {
    body: 'M14 28h36l-4 22H18l-4-22Z',
    lines: 'M22 28c0-8 4-14 10-14s10 6 10 14M24 28l2 22M32 28v22M40 28l-2 22',
  },
};

/** The tint family each drawing sits on (green / harvest / soil / info). */
export const CROP_TONE: Record<ListingCategory, 'green' | 'harvest' | 'soil' | 'info'> = {
  crop: 'harvest',
  vegetable: 'green',
  fruit: 'harvest',
  livestock: 'soil',
  poultry: 'harvest',
  dairy: 'info',
  fish: 'info',
  processed: 'soil',
  seeds_inputs: 'green',
  other: 'green',
};

export function CropArt({
  category,
  className,
}: {
  category: ListingCategory;
  className?: string;
}) {
  const art = ART[category] ?? ART.other;
  return (
    <svg
      viewBox="0 0 64 64"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      focusable="false"
      className={className}
    >
      <path d={art.body} fill="currentColor" fillOpacity={0.14} />
      <path d={art.lines} />
    </svg>
  );
}
