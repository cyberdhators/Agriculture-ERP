'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState, type FormEvent } from 'react';

import {
  LISTING_CATEGORIES,
  type ListingCategory,
  SAVED_SEARCH_LIMIT,
  type SavedSearch,
  type SavedSearchTarget,
  savedSearchSchema,
} from '@agri-erp/shared';

import { Button, Field, Input, Notice, Select } from '@/components/ui';
import {
  SavedSearchError,
  deleteSavedSearch,
  listSavedSearches,
  listStates,
  saveSearch,
  setSearchPaused,
} from '@/lib/account/saved-searches';
import { CATEGORY_KEY } from '@/lib/farmers/listings';
import { formatDate } from '@/lib/format';
import { t, type Language } from '@/lib/i18n';

/**
 * SAVED SEARCHES (2026-11-03, owner-approved). docs/DECISIONS.md, "Saved
 * searches". Shared by both shells (a phone account and an email account),
 * in English and Arabic:
 *
 *   SaveSearchPanel -- "Save this search" on the market and search screens,
 *                      filled in from the screen's filters, changeable
 *   SavedSearchList -- the "Saved searches" page: each search with Pause /
 *                      Resume and Delete, and a form to add one
 *
 * An alert for a saved search is an ordinary match alert: it follows the
 * account's match-alert switches and the daily cap (lib/api/match-alerts.ts).
 */

export interface SearchSeed {
  product_name?: string;
  category?: string;
  state_id?: string;
  max_price?: string;
}

const isCategory = (c: string | undefined): c is ListingCategory =>
  !!c && (LISTING_CATEGORIES as readonly string[]).includes(c);

function useStates() {
  const [states, setStates] = useState<{ id: string; name: string }[]>([]);
  useEffect(() => {
    let live = true;
    listStates()
      .then((s) => {
        if (live) setStates(s);
      })
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, []);
  return states;
}

/** The form itself: used by the panel on a search screen and on the list page. */
function SearchForm({
  lang,
  target: fixedTarget,
  seed,
  savedHref,
  onSaved,
}: {
  lang: Language;
  /** Fixed by the screen (listings or buying requests); free on the list page. */
  target?: SavedSearchTarget;
  seed?: SearchSeed;
  /** Where "Manage saved searches" goes, or none on the list page itself. */
  savedHref?: string;
  onSaved?: (s: SavedSearch) => void;
}) {
  const states = useStates();
  const [target, setTarget] = useState<SavedSearchTarget>(fixedTarget ?? 'listing');
  const [product, setProduct] = useState(seed?.product_name ?? '');
  const [category, setCategory] = useState(isCategory(seed?.category) ? seed!.category! : '');
  const [state, setState] = useState(seed?.state_id ?? '');
  const [price, setPrice] = useState(seed?.max_price ?? '');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [outcome, setOutcome] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  // The screen's filters change: the form follows them until the person saves.
  useEffect(() => {
    setProduct(seed?.product_name ?? '');
    setCategory(isCategory(seed?.category) ? seed!.category! : '');
    setState(seed?.state_id ?? '');
    setPrice(seed?.max_price ?? '');
  }, [seed?.product_name, seed?.category, seed?.state_id, seed?.max_price]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setOutcome(null);
    const priceNumber = price.trim() === '' ? undefined : Number(price.replace(/,/g, ''));
    const parsed = savedSearchSchema.safeParse({
      target,
      ...(product.trim() ? { product_name: product.trim() } : {}),
      ...(category ? { category } : {}),
      ...(state ? { state_id: state } : {}),
      ...(target === 'listing' && priceNumber !== undefined ? { max_price_ssp: priceNumber } : {}),
    });
    if (!parsed.success) {
      const next: Record<string, string> = {};
      for (const issue of parsed.error.issues) next[String(issue.path[0] ?? 'product_name')] ??= issue.message;
      setErrors(next);
      return;
    }
    setErrors({});
    setBusy(true);
    try {
      const saved = await saveSearch(parsed.data);
      setOutcome({ ok: true, text: t('saved.saved', lang) });
      onSaved?.(saved);
    } catch (e) {
      if (e instanceof SavedSearchError && e.status === 401) {
        setOutcome({ ok: false, text: t('saved.signIn', lang) });
      } else if (e instanceof SavedSearchError && e.fields) {
        setErrors(e.fields);
      } else {
        setOutcome({
          ok: false,
          text: e instanceof Error ? e.message : t('saved.actionFailed', lang),
        });
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} style={{ display: 'grid', gap: 10 }} noValidate>
      {fixedTarget ? null : (
        <Field label={t('saved.kind', lang)} error={errors.target}>
          {(ids) => (
            <Select
              {...ids}
              value={target}
              onChange={(e) => setTarget(e.target.value as SavedSearchTarget)}
            >
              <option value="listing">{t('saved.listing', lang)}</option>
              <option value="buying_request">{t('saved.buyingRequest', lang)}</option>
            </Select>
          )}
        </Field>
      )}
      <div
        style={{
          display: 'grid',
          gap: 10,
          gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))',
        }}
      >
        <Field label={t('saved.product', lang)} error={errors.product_name}>
          {(ids) => (
            <Input
              {...ids}
              value={product}
              maxLength={80}
              dir="auto"
              onChange={(e) => setProduct(e.target.value)}
            />
          )}
        </Field>
        <Field label={t('saved.category', lang)} optional={t('saved.optional', lang)} error={errors.category}>
          {(ids) => (
            <Select {...ids} value={category} onChange={(e) => setCategory(e.target.value)}>
              <option value="">{t('saved.anyCategory', lang)}</option>
              {LISTING_CATEGORIES.map((c) => (
                <option key={c} value={c}>
                  {t(CATEGORY_KEY[c], lang)}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field label={t('saved.state', lang)} optional={t('saved.optional', lang)} error={errors.state_id}>
          {(ids) => (
            <Select {...ids} value={state} onChange={(e) => setState(e.target.value)}>
              <option value="">{t('saved.anyState', lang)}</option>
              {states.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </Select>
          )}
        </Field>
        {target === 'listing' ? (
          <Field
            label={t('saved.maxPrice', lang)}
            optional={t('saved.optional', lang)}
            error={errors.max_price_ssp}
          >
            {(ids) => (
              <Input
                {...ids}
                inputMode="decimal"
                value={price}
                onChange={(e) => setPrice(e.target.value)}
              />
            )}
          </Field>
        ) : null}
      </div>
      <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
        <Button type="submit" size="small" disabled={busy}>
          {t('saved.save', lang)}
        </Button>
        {savedHref ? (
          <Link href={savedHref} className="small">
            {t('saved.manage', lang)}
          </Link>
        ) : null}
      </div>
      {outcome ? (
        <Notice kind={outcome.ok ? 'success' : 'error'}>
          <p className="small">{outcome.text}</p>
        </Notice>
      ) : null}
    </form>
  );
}

/** "Save this search" on a market or search screen, filled in from its filters. */
export function SaveSearchPanel({
  lang,
  target,
  seed,
  savedHref,
}: {
  lang: Language;
  target: SavedSearchTarget;
  seed?: SearchSeed;
  savedHref?: string;
}) {
  return (
    <details style={{ margin: '8px 0 12px' }}>
      <summary style={{ cursor: 'pointer', fontWeight: 600 }}>{t('saved.save', lang)}</summary>
      <p className="small muted" style={{ margin: '6px 0 10px' }}>
        {t('saved.saveLead', lang)}
      </p>
      <SearchForm lang={lang} target={target} seed={seed} savedHref={savedHref} />
    </details>
  );
}

/** One search in words: "Produce listings · sorghum · Crops · State · up to 5,000 SSP". */
function describe(s: SavedSearch, lang: Language): string {
  return [
    t(s.target === 'listing' ? 'saved.listing' : 'saved.buyingRequest', lang),
    s.product_name,
    isCategory(s.category ?? undefined) ? t(CATEGORY_KEY[s.category as ListingCategory], lang) : null,
    s.state_name ?? t('saved.anyState', lang),
    s.max_price_ssp !== null
      ? `${t('saved.upTo', lang)} ${s.max_price_ssp.toLocaleString('en')} SSP`
      : null,
  ]
    .filter(Boolean)
    .join(' · ');
}

/** The "Saved searches" page body, for either shell. */
export function SavedSearchList({ lang }: { lang: Language }) {
  const [rows, setRows] = useState<SavedSearch[] | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(() => {
    listSavedSearches()
      .then((list) => {
        setRows(list);
        setFailed(null);
      })
      .catch(() => setFailed(t('saved.failed', lang)));
  }, [lang]);

  useEffect(() => {
    load();
  }, [load]);

  async function act(id: string, run: () => Promise<unknown>) {
    setBusy(id);
    setFailed(null);
    try {
      await run();
      load();
    } catch (e) {
      setFailed(e instanceof Error ? e.message : t('saved.actionFailed', lang));
    } finally {
      setBusy(null);
    }
  }

  const full = (rows?.length ?? 0) >= SAVED_SEARCH_LIMIT;

  return (
    <div style={{ display: 'grid', gap: 16 }}>
      <p className="small muted">{t('saved.lead', lang)}</p>
      {failed ? <Notice kind="error">{failed}</Notice> : null}
      {rows === null ? null : rows.length === 0 ? (
        <p className="small">{t('saved.empty', lang)}</p>
      ) : (
        <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'grid', gap: 10 }}>
          {rows.map((row) => (
            <li
              key={row.id}
              style={{
                display: 'flex',
                gap: 8,
                alignItems: 'center',
                justifyContent: 'space-between',
                flexWrap: 'wrap',
                borderBottom: '1px solid var(--border, #e5e5e5)',
                paddingBottom: 8,
              }}
            >
              <span style={{ minWidth: 0, flex: '1 1 220px' }}>
                <strong dir="auto">{describe(row, lang)}</strong>
                <br />
                <span className="small muted">
                  {row.paused ? `${t('saved.paused', lang)} · ` : ''}
                  {t('saved.since', lang)} {formatDate(row.created_at, lang)}
                </span>
              </span>
              <span style={{ display: 'flex', gap: 8 }}>
                <Button
                  variant="secondary"
                  size="small"
                  disabled={busy === row.id}
                  onClick={() => void act(row.id, () => setSearchPaused(row.id, !row.paused))}
                >
                  {t(row.paused ? 'saved.resume' : 'saved.pause', lang)}
                </Button>
                <Button
                  variant="ghost"
                  size="small"
                  disabled={busy === row.id}
                  onClick={() => void act(row.id, () => deleteSavedSearch(row.id))}
                >
                  {t('saved.delete', lang)}
                </Button>
              </span>
            </li>
          ))}
        </ul>
      )}
      <section>
        <h2 style={{ fontSize: '1.05rem' }}>{t('saved.add', lang)}</h2>
        {full ? (
          <p className="small muted">{t('saved.lead', lang)}</p>
        ) : (
          <SearchForm lang={lang} onSaved={() => load()} />
        )}
      </section>
    </div>
  );
}
