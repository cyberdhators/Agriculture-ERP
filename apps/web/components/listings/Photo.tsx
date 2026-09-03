import type { Language } from '@/lib/i18n';
import { t } from '@/lib/i18n';
import type { ListingCategory } from '@/lib/fixtures/farmers';
import { CATEGORY_KEY } from '@/lib/farmers/listings';

import styles from './listings.module.css';

/**
 * A listing photo in a 4:3 frame with a hairline, object-fit cover. Only a
 * local object URL or data URI is ever rendered as an image; a storage path is
 * resolved later by the API, so until then the frame shows a tokenised block
 * with the category word — never a broken image. No source at all reads "No
 * photo" in the same block.
 */
export function Photo({
  src,
  category,
  lang,
  alt = '',
  note,
  tag,
  square = false,
}: {
  src: string | null;
  category: ListingCategory;
  lang: Language;
  alt?: string;
  note?: string;
  tag?: string;
  square?: boolean;
}) {
  const local = src !== null && (src.startsWith('blob:') || src.startsWith('data:'));
  return (
    <div className={`${styles.frame} ${square ? styles.frameSquare : ''}`}>
      {local ? (
        <img src={src} alt={alt} />
      ) : (
        <div
          className={styles.placeholder}
          role="img"
          aria-label={alt || t(CATEGORY_KEY[category], lang)}
        >
          <span className={styles.placeholderWord}>
            {src === null ? t('listings.noPhoto', lang) : t(CATEGORY_KEY[category], lang)}
          </span>
          {note ? <span className={styles.placeholderNote}>{note}</span> : null}
        </div>
      )}
      {tag ? <span className={styles.frameTag}>{tag}</span> : null}
    </div>
  );
}
