'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';

import { ADVICE_TOPICS, LANGUAGES, type AdviceTopic, type Language } from '@agri-erp/shared';

import { PageHead } from '@/components/farmer/AccountShell';
import styles from '@/components/farmer/farmer.module.css';
import {
  Badge,
  Button,
  ButtonLink,
  Card,
  CardBody,
  EmptyState,
  Notice,
  SearchInput,
  Select,
} from '@/components/ui';
import { useFarmerSession } from '@/lib/farmer-session';
import { formatBytes } from '@/lib/format';
import { t, type TKey } from '@/lib/i18n';
import {
  getGuide,
  guideFileLink,
  guideText,
  listGuides,
  type GuideFilter,
  type PublicGuide,
} from '@/lib/library/guides';
import { useQueryState } from '@/lib/query-state';

/**
 * /learn -- Advice & Learning's published guides, for anyone (2026-10-22;
 * "Public visitors can browse published listings and advice"). A visitor
 * needs no account; a signed-in farmer sees it inside their workspace
 * (MarketShell). In the reader's language: an Arabic reader gets the Arabic
 * title and summary where the guide has them, and the English, said so,
 * where it does not.
 *
 * Read-only. Only published guides ever reach this page (GET /api/guides).
 * AgriOne AI stays the farmer's place for questions about their own farm; this
 * page points there rather than replacing it.
 */

const topicKey = (topic: AdviceTopic) => `guides.topic.${topic}` as TKey;
const LANGUAGE_KEY: Record<Language, TKey> = { en: 'guides.langEn', ar: 'guides.langAr' };

function pick<T extends string>(list: readonly T[], value: string): T | '' {
  return (list as readonly string[]).includes(value) ? (value as T) : '';
}

function formatDay(iso: string, language: Language): string {
  return new Date(iso).toLocaleDateString(language === 'ar' ? 'ar' : 'en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}

export function GuidesPage() {
  const { farmer, language } = useFarmerSession();
  const { get, set } = useQueryState();
  const topic = pick(ADVICE_TOPICS, get('topic'));
  const fileLanguage = pick(LANGUAGES, get('lang'));
  const q = get('q');

  const [guides, setGuides] = useState<PublicGuide[] | null>(null);
  const [error, setError] = useState(false);

  // The search is sent after a pause in typing, not on every key: on a
  // metered phone each request costs.
  const [debouncedQ, setDebouncedQ] = useState(q);
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedQ(q), 350);
    return () => clearTimeout(timer);
  }, [q]);

  const filter: GuideFilter = useMemo(
    () => ({ topic, language: fileLanguage, q: debouncedQ }),
    [topic, fileLanguage, debouncedQ],
  );

  useEffect(() => {
    let on = true;
    setError(false);
    listGuides(filter)
      .then((list) => on && setGuides(list))
      .catch(() => {
        if (!on) return;
        setGuides([]);
        setError(true);
      });
    return () => {
      on = false;
    };
  }, [filter]);

  const filtered = Boolean(topic || fileLanguage || q);

  return (
    <>
      <PageHead title={t('guides.title', language)} lead={t('guides.lead', language)} />

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--s-3)', margin: 'var(--s-4) 0' }}>
        <div style={{ flex: '1 1 240px' }}>
          <SearchInput
            label={t('guides.search', language)}
            placeholder={t('guides.searchPlaceholder', language)}
            value={q}
            onChange={(event) => set({ q: event.target.value })}
          />
        </div>
        <div>
          <label htmlFor="guides-topic" className="visually-hidden">
            {t('guides.topic', language)}
          </label>
          <Select
            id="guides-topic"
            value={topic}
            onChange={(event) => set({ topic: event.target.value })}
          >
            <option value="">{t('guides.allTopics', language)}</option>
            {ADVICE_TOPICS.map((tp) => (
              <option key={tp} value={tp}>
                {t(topicKey(tp), language)}
              </option>
            ))}
          </Select>
        </div>
        <div>
          <label htmlFor="guides-lang" className="visually-hidden">
            {t('guides.language', language)}
          </label>
          <Select
            id="guides-lang"
            value={fileLanguage}
            onChange={(event) => set({ lang: event.target.value })}
          >
            <option value="">{t('guides.allLanguages', language)}</option>
            {LANGUAGES.map((l) => (
              <option key={l} value={l}>
                {t(LANGUAGE_KEY[l], language)}
              </option>
            ))}
          </Select>
        </div>
      </div>

      {guides === null ? (
        <p className="muted">{t('guides.loading', language)}</p>
      ) : error ? (
        <EmptyState error title={t('guides.error', language)} body={null} />
      ) : guides.length === 0 ? (
        <EmptyState
          title={t(filtered ? 'guides.emptyFiltered' : 'guides.empty', language)}
          body={t('guides.lead', language)}
          actions={
            filtered ? (
              <ButtonLink href="/learn" variant="secondary">
                {t('guides.allTopics', language)}
              </ButtonLink>
            ) : null
          }
        />
      ) : (
        <>
          <p className="small muted" aria-live="polite">
            {guides.length} {t('guides.count', language)}
          </p>
          <div className={styles.serviceGrid}>
            {guides.map((guide) => (
              <GuideCard key={guide.id} guide={guide} language={language} />
            ))}
          </div>
        </>
      )}

      {farmer ? (
        <p className="small" style={{ marginTop: 'var(--s-5)' }}>
          <Link href="/farmer/account/ai">{t('guides.askAi', language)}</Link>
        </p>
      ) : null}
    </>
  );
}

function GuideCard({ guide, language }: { guide: PublicGuide; language: Language }) {
  const text = guideText(guide, language);
  return (
    <Card>
      <CardBody>
        <div className={styles.serviceHead}>
          <Badge tone="nile">{t(`guides.format.${guide.format}` as TKey, language)}</Badge>
          <h3 dir="auto">
            <Link href={`/learn/${guide.id}`}>{text.title}</Link>
          </h3>
        </div>
        {text.summary ? (
          <p
            className="small"
            dir="auto"
            style={{ color: 'var(--ink-2)', marginTop: 'var(--s-2)' }}
          >
            {text.summary}
          </p>
        ) : null}
        <div className={styles.serviceChips}>
          {guide.topics.map((tp) => (
            <span key={tp} className={styles.serviceChip}>
              {t(topicKey(tp), language)}
            </span>
          ))}
        </div>
        <p className="small muted" style={{ marginTop: 'var(--s-2)' }}>
          {t('guides.fileIn', language)} {t(LANGUAGE_KEY[guide.language], language)} ·{' '}
          {formatBytes(guide.byte_size)} · {formatDay(guide.published_on, language)}
        </p>
      </CardBody>
    </Card>
  );
}

export function GuidePage({ id }: { id: string }) {
  const { farmer, language } = useFarmerSession();
  const [guide, setGuide] = useState<PublicGuide | null | undefined>(undefined);
  const [error, setError] = useState(false);
  const [opening, setOpening] = useState(false);
  const [fileMessage, setFileMessage] = useState<string | null>(null);

  useEffect(() => {
    let on = true;
    getGuide(id)
      .then((g) => on && setGuide(g))
      .catch(() => {
        if (!on) return;
        setGuide(null);
        setError(true);
      });
    return () => {
      on = false;
    };
  }, [id]);

  async function openFile() {
    setFileMessage(null);
    setOpening(true);
    try {
      const url = await guideFileLink(id);
      if (url) window.location.assign(url);
      else setFileMessage(t('guides.filePreview', language));
    } catch {
      setFileMessage(t('guides.fileUnavailable', language));
    } finally {
      setOpening(false);
    }
  }

  const back = (
    <ButtonLink href="/learn" variant="ghost">
      {t('guides.back', language)}
    </ButtonLink>
  );

  if (guide === undefined) return <p className="muted">{t('guides.loading', language)}</p>;
  if (!guide) {
    return (
      <EmptyState
        error={error}
        title={t(error ? 'guides.error' : 'guides.notFound', language)}
        body={null}
        actions={back}
      />
    );
  }

  const text = guideText(guide, language);
  return (
    <>
      <PageHead title={text.title} lead={t('guides.eyebrow', language)} actions={back} />
      {!text.translated ? <Notice kind="info">{t('guides.englishOnly', language)}</Notice> : null}
      <Card>
        <CardBody>
          <div className={styles.serviceChips}>
            <Badge tone="nile">{t(`guides.format.${guide.format}` as TKey, language)}</Badge>
            {guide.topics.map((tp) => (
              <span key={tp} className={styles.serviceChip}>
                {t(topicKey(tp), language)}
              </span>
            ))}
          </div>
          {text.summary ? (
            <p dir="auto" style={{ marginTop: 'var(--s-3)', whiteSpace: 'pre-line' }}>
              {text.summary}
            </p>
          ) : null}
          <dl className={styles.serviceDl}>
            <dt>{t('guides.fileIn', language)}</dt>
            <dd>{t(LANGUAGE_KEY[guide.language], language)}</dd>
            <dt>{t('guides.size', language)}</dt>
            <dd className="mono">{formatBytes(guide.byte_size)}</dd>
            <dt>{t('guides.published', language)}</dt>
            <dd>{formatDay(guide.published_on, language)}</dd>
          </dl>
          <div style={{ marginTop: 'var(--s-4)' }}>
            <Button onClick={openFile} disabled={opening}>
              {opening ? t('guides.opening', language) : t('guides.openFile', language)} ·{' '}
              {formatBytes(guide.byte_size)}
            </Button>
          </div>
          {fileMessage ? (
            <p className="small muted" role="status" style={{ marginTop: 'var(--s-2)' }}>
              {fileMessage}
            </p>
          ) : null}
        </CardBody>
      </Card>
      {farmer ? (
        <p className="small" style={{ marginTop: 'var(--s-5)' }}>
          <Link href="/farmer/account/ai">{t('guides.askAi', language)}</Link>
        </p>
      ) : null}
    </>
  );
}
