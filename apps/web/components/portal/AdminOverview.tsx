'use client';

import Link from 'next/link';
import { useCallback, useEffect, useId, useMemo, useState } from 'react';

import {
  type AdminOverview as Overview,
  type AdminOverviewFilter,
  OVERVIEW_ACTORS,
  OVERVIEW_ACTOR_LABELS,
  OVERVIEW_PRESET_DAYS,
  OVERVIEW_UNAVAILABLE_TEXT,
  type OverviewActor,
  type OverviewCaseId,
  type OverviewDestination,
  type OverviewFigure,
  type OverviewTileId,
  adminOverviewFilterSchema,
  jubaToday,
  overviewHref,
  presetRange,
} from '@agri-erp/shared';

import { formatJubaTime } from '@/lib/admin/access-view';
import { OverviewApiError, getAdminOverview } from '@/lib/portal/admin-overview-api';
import { useLocationNames } from '@/lib/portal/locations';
import { barRects, ceilingOf, linePath, total } from '@/lib/portal/overview-charts';
import { usePreview } from '@/lib/preview';
import { useQueryState } from '@/lib/query-state';

import { Button, Card, Field, Notice, PageHeader, Select } from '../ui';
import { DateRangePicker, LoadingState, StatCard, StatGrid } from '../ui/data';
import styles from './admin-overview.module.css';

/**
 * THE ADMINISTRATION OVERVIEW (2026-10-28). CORWADO's specification, section 4:
 * "Overview -- activity summaries, unresolved cases and system alerts; filters
 * link to detail", drawn as the infographic "AgriOne Admin Portal, 1 of 3",
 * panel 1.
 *
 * Every figure comes from GET /api/admin/overview, scoped by the server.
 * People, sign-in accounts and organisational profiles are separate cards and
 * never added together. Each card opens the list behind it with the same
 * filters. A figure the server cannot produce says "Not measured" and why --
 * never a zero.
 *
 * The extension-officer verification figures (the national programme
 * overview this page replaced as the headline) are one link away, at
 * /reports/programme.
 */

const TILE_TEXT: Readonly<Record<OverviewTileId, { label: string; note: string }>> = {
  people: {
    label: 'Registered people',
    note: 'Farmers and buyers on the register, including farmers an officer registered with no sign-in.',
  },
  accounts: {
    label: 'Sign-in accounts',
    note: 'Accounts that can sign in. One account may hold a farmer and a buyer record.',
  },
  organisations: {
    label: 'Organisation profiles',
    note: 'Groups, businesses and institutions that are open. Not people.',
  },
  new_accounts: { label: 'New accounts', note: 'Accounts created in the period.' },
  active_users: { label: 'Active users', note: 'Accounts that signed in during the period.' },
  active_listings: {
    label: 'Active listings',
    note: 'Produce and input listings on the market now.',
  },
  active_services: { label: 'Active services', note: 'Service offers on the market now.' },
  active_buying_requests: {
    label: 'Buying requests',
    note: 'Open buying requests on the market now.',
  },
};

const CASE_TEXT: Readonly<Record<OverviewCaseId, string>> = {
  support: 'Support cases',
  appeals: 'Appeals',
  product_reports: 'Product reports',
  corrections: 'Correction requests',
  adviser_applications: 'Adviser applications',
};

const isActor = (v: string): v is OverviewActor =>
  (OVERVIEW_ACTORS as readonly string[]).includes(v);

interface Draft {
  from: string;
  to: string;
  state: string;
  actor: string;
}

export function AdminOverview() {
  const { hydrated } = usePreview();
  const { get, set } = useQueryState();
  const names = useLocationNames(hydrated);

  /** The applied filters live in the URL, so a view can be bookmarked and shared. */
  const applied = useMemo<AdminOverviewFilter>(() => {
    const from = get('from');
    const to = get('to');
    const state = get('state');
    const actor = get('actor');
    return {
      ...(from ? { from } : {}),
      ...(to ? { to } : {}),
      ...(state ? { state_id: state } : {}),
      ...(isActor(actor) ? { actor } : {}),
    };
  }, [get]);

  const [draft, setDraft] = useState<Draft>({ from: '', to: '', state: '', actor: '' });
  const [fieldError, setFieldError] = useState<string | undefined>();
  const [data, setData] = useState<Overview | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<{ status: number; message: string } | undefined>();

  useEffect(() => {
    setDraft({
      from: applied.from ?? '',
      to: applied.to ?? '',
      state: applied.state_id ?? '',
      actor: applied.actor ?? '',
    });
  }, [applied]);

  const load = useCallback(async (filter: AdminOverviewFilter) => {
    setLoading(true);
    setError(undefined);
    try {
      setData(await getAdminOverview(filter));
    } catch (e) {
      setData(null);
      setError({
        status: e instanceof OverviewApiError ? e.status : 0,
        message: e instanceof Error ? e.message : 'The overview could not be loaded.',
      });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (hydrated) void load(applied);
  }, [applied, hydrated, load]);

  function applyDraft(next: Draft) {
    const parsed = adminOverviewFilterSchema.safeParse({
      ...(next.from ? { from: next.from } : {}),
      ...(next.to ? { to: next.to } : {}),
      ...(next.state ? { state_id: next.state } : {}),
      ...(next.actor ? { actor: next.actor } : {}),
    });
    if (!parsed.success) {
      setFieldError(parsed.error.issues[0]?.message);
      return;
    }
    setFieldError(undefined);
    set({
      from: next.from || null,
      to: next.to || null,
      state: next.state || null,
      actor: next.actor || null,
    });
  }

  function preset(days: number) {
    const range = presetRange(days, jubaToday());
    applyDraft({ ...draft, ...range });
  }

  const stateName = (id: string) => names.state(id) ?? id;
  const href = (target: OverviewDestination) => overviewHref(target, applied);

  if (!hydrated) return null;

  return (
    <div className={styles.page}>
      <PageHeader
        eyebrow="Overview"
        title="Platform overview"
        subtitle="Accounts, marketplace activity, open cases and system alerts. Every figure opens the list behind it."
      />

      <Card padded>
        <div className={styles.presets} role="group" aria-label="Quick periods">
          {OVERVIEW_PRESET_DAYS.map((days) => (
            <Button key={days} variant="ghost" onClick={() => preset(days)}>
              Last {days} days
            </Button>
          ))}
        </div>
        <div className={styles.filters}>
          <DateRangePicker
            from={draft.from}
            to={draft.to}
            max={jubaToday()}
            onChange={(next) => setDraft((d) => ({ ...d, ...next }))}
          />
          <Field label="Location" optional>
            {(ids) => (
              <Select
                {...ids}
                value={draft.state}
                onChange={(e) => setDraft((d) => ({ ...d, state: e.target.value }))}
              >
                <option value="">All locations in scope</option>
                {names.states.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <Field label="Actor type" optional>
            {(ids) => (
              <Select
                {...ids}
                value={draft.actor}
                onChange={(e) => setDraft((d) => ({ ...d, actor: e.target.value }))}
              >
                <option value="">All actor types</option>
                {OVERVIEW_ACTORS.map((a) => (
                  <option key={a} value={a}>
                    {OVERVIEW_ACTOR_LABELS[a]}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <div className={styles.apply}>
            <Button variant="secondary" onClick={() => applyDraft(draft)}>
              Apply
            </Button>
            <Button
              variant="ghost"
              onClick={() => {
                setFieldError(undefined);
                set({ from: null, to: null, state: null, actor: null });
              }}
            >
              Clear
            </Button>
          </div>
        </div>
        {fieldError ? (
          <p className={styles.fieldError} role="alert">
            {fieldError}
          </p>
        ) : null}
      </Card>

      {loading ? <LoadingState rows={4} label="Loading the overview" /> : null}

      {!loading && error ? (
        <Notice
          kind="error"
          title={
            error.status === 403
              ? 'You cannot view the overview'
              : 'The overview could not be loaded'
          }
        >
          {error.status === 403
            ? 'The overview needs the "View data and reports" permission. An administrator can give it through the Analyst preset.'
            : error.message}
        </Notice>
      ) : null}

      {!loading && data ? (
        <>
          <p className={styles.windowLine}>
            <b>
              {data.window.from} to {data.window.to}
            </b>
            <span>{data.window.days} days, Juba time</span>
            <span>
              {data.state_id ? `Location: ${stateName(data.state_id)}` : 'All locations in scope'}
            </span>
            <span>
              {data.actor ? `Actor type: ${OVERVIEW_ACTOR_LABELS[data.actor]}` : 'All actor types'}
            </span>
            <span>
              Scope: {data.scope_states ? data.scope_states.map(stateName).join(', ') : 'National'}
            </span>
            <span>Updated {formatJubaTime(data.generated_at)}</span>
          </p>
          {data.actor ? (
            <p className={styles.note}>
              One account may declare several activities, so figures for different actor types
              overlap and do not add up. Cases are not narrowed by actor type.
            </p>
          ) : null}

          {data.alerts.length > 0 ? (
            <section className={styles.section} aria-labelledby="ov-alerts">
              <h2 id="ov-alerts" className={styles.sectionTitle}>
                System alerts
              </h2>
              <div className={styles.alerts}>
                {data.alerts.map((a) => (
                  <Notice key={a.id} kind={a.level} title={a.title}>
                    {a.body}{' '}
                    {a.href ? (
                      <Link href={a.href} className={styles.link}>
                        Open
                      </Link>
                    ) : null}
                  </Notice>
                ))}
              </div>
            </section>
          ) : (
            <Notice kind="success" title="No system alerts">
              Nothing failed in this period and every integration you can see is configured.
            </Notice>
          )}

          <section className={styles.section} aria-labelledby="ov-activity">
            <h2 id="ov-activity" className={styles.sectionTitle}>
              Accounts and activity
            </h2>
            <StatGrid>
              {data.tiles.map((t) => (
                <FigureCard
                  key={t.id}
                  figure={t}
                  label={TILE_TEXT[t.id].label}
                  note={TILE_TEXT[t.id].note}
                  href={href(t.id)}
                />
              ))}
            </StatGrid>
          </section>

          <section className={styles.section} aria-labelledby="ov-cases">
            <h2 id="ov-cases" className={styles.sectionTitle}>
              Open cases
            </h2>
            <Card padded>
              <ul className={styles.cases}>
                {data.cases.map((c) => (
                  <CaseRow key={c.id} figure={c} label={CASE_TEXT[c.id]} href={href(c.id)} />
                ))}
              </ul>
            </Card>
          </section>

          <section className={styles.charts} aria-label="Trends">
            <RegistrationsChart data={data} href={href('registrations')} />
            <MarketChart data={data} href={href('market')} />
          </section>

          <Card padded>
            <h2 className={styles.sectionTitle}>Farmer verification programme</h2>
            <p className={styles.note}>
              The extension-officer figures — registrations, verification, reach and the review
              queue — are kept on their own page.
            </p>
            <Link href="/reports/programme" className={styles.link}>
              Open the programme figures
            </Link>
          </Card>
        </>
      ) : null}
    </div>
  );
}

function FigureCard({
  figure,
  label,
  note,
  href,
}: {
  figure: OverviewFigure;
  label: string;
  note: string;
  href: string;
}) {
  return (
    <StatCard
      label={label}
      value={figure.value}
      note={
        <>
          {note}
          {figure.part ? (
            <>
              {' '}
              <b>
                {figure.part.value.toLocaleString('en')} {figure.part.label}.
              </b>
            </>
          ) : null}
        </>
      }
      {...(figure.unavailable
        ? { unmeasuredBecause: OVERVIEW_UNAVAILABLE_TEXT[figure.unavailable] }
        : {})}
      footer={
        <Link href={href} className={styles.link}>
          Open list
        </Link>
      }
    />
  );
}

function CaseRow({ figure, label, href }: { figure: OverviewFigure; label: string; href: string }) {
  return (
    <li className={styles.caseRow}>
      <span className={styles.caseLabel}>{label}</span>
      {figure.value === null ? (
        <span className={styles.caseMissing}>
          Not measured
          {figure.unavailable ? ` — ${OVERVIEW_UNAVAILABLE_TEXT[figure.unavailable]}` : ''}
        </span>
      ) : (
        <span className={figure.value > 0 ? styles.caseCountOpen : styles.caseCount}>
          {figure.value.toLocaleString('en')} open
        </span>
      )}
      <Link href={href} className={styles.link}>
        Open queue
      </Link>
    </li>
  );
}

const BOX = { width: 600, height: 160, pad: 12 } as const;

function RegistrationsChart({ data, href }: { data: Overview; href: string }) {
  const id = useId();
  const days = data.trends.registrations;
  return (
    <figure className={styles.chart}>
      <figcaption className={styles.chartHead}>
        <span className={styles.chartTitle}>User registrations</span>
        <Link href={href} className={styles.link}>
          Details
        </Link>
      </figcaption>
      {days === null ? (
        <p className={styles.note}>{OVERVIEW_UNAVAILABLE_TEXT.not_in_database}</p>
      ) : (
        <>
          <svg
            role="img"
            aria-labelledby={`${id}-t ${id}-d`}
            viewBox={`0 0 ${BOX.width} ${BOX.height}`}
            className={styles.svg}
            preserveAspectRatio="none"
          >
            <title id={`${id}-t`}>New accounts per day</title>
            <desc id={`${id}-d`}>
              {`${total(days.map((d) => d.value))} new accounts from ${data.window.from} to ${data.window.to}.`}
            </desc>
            <line x1={0} y1={BOX.height} x2={BOX.width} y2={BOX.height} className={styles.axis} />
            {barRects(
              days.map((d) => d.value),
              BOX,
            ).map((r, i) => (
              <rect key={days[i]?.date ?? i} {...r} className={styles.bar}>
                <title>{`${days[i]?.date}: ${days[i]?.value}`}</title>
              </rect>
            ))}
          </svg>
          <p className={styles.chartFoot}>
            <span>{data.window.from}</span>
            <span>
              {total(days.map((d) => d.value)).toLocaleString('en')} new accounts, peak{' '}
              {Math.max(0, ...days.map((d) => d.value)).toLocaleString('en')} a day
            </span>
            <span>{data.window.to}</span>
          </p>
        </>
      )}
    </figure>
  );
}

function MarketChart({ data, href }: { data: Overview; href: string }) {
  const id = useId();
  const days = data.trends.market;
  const listings = days.map((d) => d.listings);
  const requests = days.map((d) => d.buying_requests);
  const max = ceilingOf(listings, requests);
  return (
    <figure className={styles.chart}>
      <figcaption className={styles.chartHead}>
        <span className={styles.chartTitle}>Listings and buying requests</span>
        <Link href={href} className={styles.link}>
          Details
        </Link>
      </figcaption>
      <svg
        role="img"
        aria-labelledby={`${id}-t ${id}-d`}
        viewBox={`0 0 ${BOX.width} ${BOX.height}`}
        className={styles.svg}
        preserveAspectRatio="none"
      >
        <title id={`${id}-t`}>Listings and buying requests created per day</title>
        <desc id={`${id}-d`}>
          {`${total(listings)} listings and services and ${total(requests)} buying requests created from ${data.window.from} to ${data.window.to}.`}
        </desc>
        <line x1={0} y1={BOX.height} x2={BOX.width} y2={BOX.height} className={styles.axis} />
        <path d={linePath(listings, BOX, max)} className={styles.lineListings} />
        <path d={linePath(requests, BOX, max)} className={styles.lineRequests} />
      </svg>
      <p className={styles.legend}>
        <span className={styles.keyListings}>
          Listings and services: {total(listings).toLocaleString('en')}
        </span>
        <span className={styles.keyRequests}>
          Buying requests: {total(requests).toLocaleString('en')}
        </span>
      </p>
      <p className={styles.chartFoot}>
        <span>{data.window.from}</span>
        <span>Created per day; buying requests are not completed sales.</span>
        <span>{data.window.to}</span>
      </p>
    </figure>
  );
}
