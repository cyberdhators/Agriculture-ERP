'use client';

import { ADVICE_TOPICS, type AdviceTopic, type PublicExpertise } from '@agri-erp/shared';

import { Stamp } from '@/components/ui';
import { TOPIC_KEY } from '@/lib/advice/labels';
import { t, type Language } from '@/lib/i18n';

import styles from './profiles.module.css';

const isTopic = (x: string): x is AdviceTopic => (ADVICE_TOPICS as readonly string[]).includes(x);

/**
 * 2026-10-28 (user journeys, infographic no. 5): "relevant expertise" on a
 * public profile -- the "Approved adviser" badge when the account holds that
 * authorization, and the topics of its published advice profile. Nothing at
 * all when it has neither. Public visibility is not endorsement (the page says so).
 */
export function Expertise({
  expertise,
  language,
}: {
  expertise: PublicExpertise | null | undefined;
  language: Language;
}) {
  if (!expertise) return null;
  const topics = expertise.topics.filter(isTopic);
  if (!expertise.approved_adviser && topics.length === 0) return null;
  return (
    <div>
      <p className="small muted" style={{ margin: '0 0 4px' }}>
        {t('profile.expertise', language)}
      </p>
      {expertise.approved_adviser ? (
        <Stamp kind="verified">{t('advice.approvedBadge', language)}</Stamp>
      ) : null}
      {topics.length > 0 ? (
        <ul className={styles.chips}>
          {topics.map((topic) => (
            <li key={topic}>{t(TOPIC_KEY[topic], language)}</li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
