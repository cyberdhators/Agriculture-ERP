'use client';

import { FormatIcon } from '@/components/library/resource-presentation';
import { Notice } from '@/components/ui';
import { useFarmerSession } from '@/lib/farmer-session';
import { LEARNING_RESOURCES, type LearningResourceRow } from '@/lib/fixtures/p1';
import { FORMAT_LABELS, TOPIC_LABELS, formatBytes, formatDate } from '@/lib/format';
import { t } from '@/lib/i18n';

import { PageHead } from './AccountShell';
import styles from './farmer.module.css';

/**
 * Learning materials, for a farmer. Published resources only, the farmer's
 * language first. The files themselves do not open here yet: the library has
 * no upload or signed-link route (audit, B1), so the page says how the farmer
 * gets the material today — from their officer on a visit — rather than
 * offering a button that does nothing. Off live this reads the fixtures; a
 * farmer-side route replaces that when the farmer principal lands.
 */
export function FarmerLearn() {
  const { farmer, language } = useFarmerSession();
  if (!farmer) return null;

  const published = LEARNING_RESOURCES.filter((r) => r.published && r.deleted_at === null);
  const mine = published.filter((r) => r.language === language);
  const other = published.filter((r) => r.language !== language);

  return (
    <>
      <PageHead title={t('learn.title', language)} lead={t('learn.lead', language)} />

      <Notice kind="info" title={t('learn.howTitle', language)}>
        <p className="small">{t('learn.howBody', language)}</p>
      </Notice>

      {published.length === 0 ? (
        <p className="muted">{t('learn.empty', language)}</p>
      ) : (
        <>
          <ResourceList
            title={t('learn.inYourLanguage', language)}
            rows={mine}
            language={language}
            empty={t('learn.noneInLanguage', language)}
          />
          {other.length > 0 ? (
            <ResourceList
              title={t('learn.otherLanguages', language)}
              rows={other}
              language={language}
            />
          ) : null}
        </>
      )}
    </>
  );
}

function ResourceList({
  title,
  rows,
  language,
  empty,
}: {
  title: string;
  rows: LearningResourceRow[];
  language: 'en' | 'ar-juba';
  empty?: string;
}) {
  return (
    <section className={styles.block} aria-label={title}>
      <div className={styles.blockHead}>
        <h2>{title}</h2>
        <span className="small muted">{rows.length}</span>
      </div>
      {rows.length === 0 ? (
        <p className="small muted">{empty}</p>
      ) : (
        <ul className={styles.learnList}>
          {rows.map((r) => (
            <li key={r.id} className={styles.learnItem}>
              <span className={styles.learnIcon} aria-hidden>
                <FormatIcon format={r.format} size={22} />
              </span>
              <div className={styles.learnText}>
                <div className={styles.learnTitle} dir="auto">
                  {r.title}
                </div>
                <div className="small muted">
                  {TOPIC_LABELS[r.topic]}
                  {r.crop ? ` · ${r.crop}` : ''} · {FORMAT_LABELS[r.format]} ·{' '}
                  {formatBytes(r.byte_size)} · {formatDate(r.uploaded_at, language)}
                </div>
                {r.description ? (
                  <p className="small" dir="auto">
                    {r.description}
                  </p>
                ) : null}
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
