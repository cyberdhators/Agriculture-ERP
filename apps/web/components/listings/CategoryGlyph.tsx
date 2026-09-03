import type { ListingCategory } from '@/lib/fixtures/farmers';

/**
 * One small single-colour glyph per listing category — a grain ear, a leaf,
 * a fruit, a hoof, an egg, a milk churn, a fish, a jar, a sprouting seed and
 * a plain mark for "other". Drawn inline at 16px on a 24 grid in
 * `currentColor`, so the rail and the placeholder tint them from the tokens.
 * Always accompanied by the category word: never an icon alone.
 */
const PATHS: Record<ListingCategory, string> = {
  crop: 'M12 21V9M12 9c-3 0-5-2-5-5 3 0 5 2 5 5Zm0 0c3 0 5-2 5-5-3 0-5 2-5 5Zm0 5c-3 0-5-2-5-5 3 0 5 2 5 5Zm0 0c3 0 5-2 5-5-3 0-5 2-5 5Z',
  vegetable: 'M20 4c-8 0-14 5-14 13v3M20 4c0 8-5 14-13 14M20 4l-9 9',
  fruit: 'M12 7c-4 0-7 3-7 7s3 7 7 7 7-3 7-7-3-7-7-7Zm0 0V3m0 4c1-2 3-3 5-3',
  livestock: 'M6 4v4a6 6 0 0 0 12 0V4M9 20v-4M15 20v-4M6 12h12l1 4H5l1-4Z',
  poultry: 'M12 3c-4 0-7 6-7 11a7 7 0 0 0 14 0c0-5-3-11-7-11Z',
  dairy: 'M8 3h8v3l2 3v12H6V9l2-3V3ZM6 13h12',
  fish: 'M3 12c3-4 7-6 11-6l7 6-7 6c-4 0-8-2-11-6Zm11-6-3 6 3 6M18 9v6',
  processed: 'M7 3h10v4l2 2v12H5V9l2-2V3ZM7 12h10',
  seeds_inputs: 'M12 21v-7M12 14c-3 0-5-2-5-5 3 0 5 2 5 5Zm0 0c3 0 5-2 5-5-3 0-5 2-5 5ZM9 21h6',
  other: 'M6 12h.01M12 12h.01M18 12h.01',
};

export function CategoryGlyph({
  category,
  size = 16,
  className,
}: {
  category: ListingCategory;
  size?: number;
  className?: string;
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      focusable="false"
      className={className}
    >
      <path d={PATHS[category]} />
    </svg>
  );
}
