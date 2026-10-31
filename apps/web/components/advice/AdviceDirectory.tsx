'use client';

import Link from 'next/link';
import { useEffect, useId, useMemo, useState } from 'react';

import {
  ADVICE_DELIVERY_MODES,
  ADVICE_LANGUAGES,
  ADVICE_TOPICS,
  type AdviceProviderPublic,
} from '@agri-erp/shared';

import { SearchSelect } from '@/components/market-posts/bits';
import css from '@/components/account/settings.module.css';
import { Badge, Button, EmptyState, Input, Notice, PageHeader } from '@/components/ui';
import { listProviders } from '@/lib/advice/client';
import { KIND_KEY, LANGUAGE_KEY, MODE_KEY, TERMS_KEY, TOPIC_KEY } from '@/lib/advice/labels';
import { t, type Language } from '@/lib/i18n';

import styles from './advice.module.css';
import { PageLoading } from '@/components/ui/data';

/** "Juba, Central Equatoria" or "Anywhere". */
export function coverageLine(p: AdviceProviderPublic, lang: Language): string {
  return p.states.length === 0
    ? t('advice.anywhere', lang)
    : p.states.map((s) => s.name).join(', ');
}

/**
 * FIND ADVICE (2026-10-22). The public directory of advice providers, with
 * search and filters by topic, language, location and remote or in person,
 * done on the server. The person reads and chooses; nothing is ranked or
 * recommended, and being listed is not an endorsement -- the page says so.
 * `base` is where a provider's page lives on this side of the app.
 *
 * 2026-10-31 (the owner's screenshot: a three-sentence lead, four dropdowns
 * stacked): one title, the not-an-endorsement line at the foot of the list,
 * and on a phone the filters fold behind "Filters". Every filter, its value
 * and the request it makes are the ones they were.
 */
export function AdviceDirectory({ lang, base }: { lang: Language; base: string }) {
  const [q, setQ] = useState('');
  const [query, setQuery] = useState('');
  const [topic, setTopic] = useState('');
  const [language, setLanguage] = useState('');
  const [state, setState] = useState('');
  const [mode, setMode] = useState('');
  const [approvedOnly, setApprovedOnly] = useState(false);
  const [rows, setRows] = useState<AdviceProviderPublic[] | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const [states, setStates] = useState<Map<string, string>>(new Map());
  const [filtersOpen, setFiltersOpen] = useState(false);
  const filtersId = useId();
  const activeFilters =
    [topic, language, state, mode].filter(Boolean).length + (approvedOnly ? 1 : 0);

  useEffect(() => {
    const id = setTimeout(() => setQuery(q.trim()), 300);
    return () => clearTimeout(id);
  }, [q]);

  useEffect(() => {
    let cancelled = false;
    setRows(null);
    listProviders({
      q: query,
      topic,
      language,
      state_id: state,
      delivery_mode: mode,
      approved: approvedOnly ? '1' : '',
    })
      .then((data) => {
        if (cancelled) return;
        setRows(data);
        setFailure(null);
        // The location filter offers the states the directory has shown.
        setStates((prev) => {
          const next = new Map(prev);
          for (const p of data) for (const s of p.states) next.set(s.id, s.name);
          return next;
        });
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        setRows([]);
        setFailure(e instanceof Error ? e.message : String(e));
      });
    return () => {
      cancelled = true;
    };
  }, [query, topic, language, state, mode, approvedOnly]);

  const stateOptions = useMemo(
    () => [...states].sort((a, b) => a[1].localeCompare(b[1])),
    [states],
  );

  return (
    <div className={styles.page}>
      <PageHeader title={t('advice.find', lang)} />
      <div className={styles.toolbar}>
        <div className={styles.searchRow}>
          <Input
            type="search"
            aria-label={t('advice.search', lang)}
            placeholder={t('advice.search', lang)}
            maxLength={100}
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
          <Button
            variant="secondary"
            className={styles.filterToggle}
            aria-expanded={filtersOpen}
            aria-controls={filtersId}
            onClick={() => setFiltersOpen((o) => !o)}
          >
            {t('market.filters', lang)}
            {activeFilters > 0 ? <span className={styles.filterCount}>{activeFilters}</span> : null}
          </Button>
        </div>
        <div
          id={filtersId}
          className={
            filtersOpen ? styles.filterSet : `${styles.filterSet} ${styles.filterSetClosed}`
          }
        >
          <SearchSelect
            label={t('advice.topicLabel', lang)}
            value={topic}
            onChange={setTopic}
            options={ADVICE_TOPICS.map((v) => ({ value: v, label: t(TOPIC_KEY[v], lang) }))}
            anyLabel={t('advice.anyTopic', lang)}
          />
          <SearchSelect
            label={t('advice.languageLabel', lang)}
            value={language}
            onChange={setLanguage}
            options={ADVICE_LANGUAGES.map((v) => ({ value: v, label: t(LANGUAGE_KEY[v], lang) }))}
            anyLabel={t('advice.anyLanguage', lang)}
          />
          <SearchSelect
            label={t('advice.stateLabel', lang)}
            value={state}
            onChange={setState}
            options={stateOptions.map(([value, label]) => ({ value, label }))}
            anyLabel={t('advice.anyState', lang)}
          />
          <SearchSelect
            label={t('advice.deliveryLabel', lang)}
            value={mode}
            onChange={setMode}
            options={ADVICE_DELIVERY_MODES.map((v) => ({ value: v, label: t(MODE_KEY[v], lang) }))}
            anyLabel={t('advice.anyDelivery', lang)}
          />
          {/* 2026-10-24: approved by CORWADO (the optional pathway). 2026-10-31: a chip. */}
          <div className={styles.chipCell}>
            <label className={css.chip}>
              <input
                type="checkbox"
                checked={approvedOnly}
                onChange={(e) => setApprovedOnly(e.target.checked)}
              />
              {t('advice.approvedOnly', lang)}
            </label>
          </div>
        </div>
      </div>
      {failure ? (
        <Notice kind="error">
          <p className="small">{failure}</p>
        </Notice>
      ) : null}
      {rows === null ? (
        <PageLoading label={t('market.loading', lang)} />
      ) : rows.length === 0 ? (
        <EmptyState title={t('advice.empty', lang)} body={t('advice.emptyBody', lang)} />
      ) : (
        <ul className={styles.list}>
          {rows.map((p) => (
            <li key={p.id}>
              <Link href={`${base}/${p.id}`} className={styles.card}>
                <span className={styles.cardHead}>
                  <Badge tone="leaf">{t(KIND_KEY[p.provider_kind], lang)}</Badge>
                  <Badge tone="sorghum">{t(TERMS_KEY[p.terms], lang)}</Badge>
                  {p.approved_adviser ? (
                    <Badge tone="nile">{t('advice.approvedBadge', lang)}</Badge>
                  ) : null}
                </span>
                <span className={styles.cardTitle} dir="auto">
                  {p.display_name}
                </span>
                <span className={styles.meta}>
                  {p.topics.map((v) => t(TOPIC_KEY[v], lang)).join(' · ')}
                </span>
                <p className={`${styles.clamp} small`} dir="auto">
                  {p.description}
                </p>
                <span className={styles.meta}>
                  <span>{coverageLine(p, lang)}</span>
                  <span>{p.delivery_modes.map((v) => t(MODE_KEY[v], lang)).join(', ')}</span>
                  <span>{p.languages.map((v) => t(LANGUAGE_KEY[v], lang)).join(', ')}</span>
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
      {/* 2026-10-31: the lead's third sentence, the one that matters, said once at the foot. */}
      <p className="small muted">
        {lang === 'ar'
          ? 'الإدراج هنا ليس تزكية من كوروادو.'
          : 'Being listed here is not an endorsement by CORWADO.'}
      </p>
    </div>
  );
}
