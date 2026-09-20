'use client';

import { useState } from 'react';

import { LEARNING_TOPICS, type LearningTopic } from '@agri-erp/shared';

import { FormatIcon } from '@/components/library/resource-presentation';
import { Notice, Tabs } from '@/components/ui';
import { useFarmerSession } from '@/lib/farmer-session';
import { LEARNING_RESOURCES, type LearningResourceRow } from '@/lib/fixtures/p1';
import { FORMAT_LABELS, TOPIC_LABELS, formatBytes, formatDate } from '@/lib/format';
import { t } from '@/lib/i18n';

import { PageHead } from './AccountShell';
import styles from './farmer.module.css';

type TopicFilter = 'all' | LearningTopic;

export function FarmerLearn() {
  const { farmer, language } = useFarmerSession();
  const [topic, setTopic] = useState<TopicFilter>('all');
  if (!farmer) return null;

  const published = LEARNING_RESOURCES.filter((r) => r.published && r.deleted_at === null);
  const filtered = topic === 'all' ? published : published.filter((r) => r.topic === topic);
  const mine = filtered.filter((r) => r.language === language);
  const other = filtered.filter((r) => r.language !== language);

  const tabs: { key: TopicFilter; label: string; count: number }[] = [
    { key: 'all', label: t('learn.allTopics', language), count: published.length },
    ...LEARNING_TOPICS.filter((tp) => published.some((r) => r.topic === tp)).map((tp) => ({
      key: tp as TopicFilter,
      label: TOPIC_LABELS[tp],
      count: published.filter((r) => r.topic === tp).length,
    })),
  ];

  return (
    <>
      <PageHead title={t('learn.title', language)} lead={t('learn.lead', language)} />

      <Notice kind="info" title={t('learn.howTitle', language)}>
        <p className="small">{t('learn.howBody', language)}</p>
      </Notice>

      <Tabs
        label={t('learn.filterByTopic', language)}
        items={tabs}
        value={topic}
        onChange={setTopic}
      />

      {filtered.length === 0 ? (
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
