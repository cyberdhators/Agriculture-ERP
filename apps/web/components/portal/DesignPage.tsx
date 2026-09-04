'use client';

import { useState } from 'react';

import {
  Avatar,
  Badge,
  Button,
  Card,
  CardBody,
  CardHeader,
  Checkbox,
  Chips,
  Dialog,
  EmptyState,
  Field,
  Input,
  Notice,
  PageHeader,
  PrefixedInput,
  SearchInput,
  Select,
  Skeleton,
  Stamp,
  SyncChip,
  Tabs,
  Textarea,
} from '../ui';
import { Wordmark } from '../brand/Wordmark';
import { Boundary } from '../farmers/Boundary';
import { CategoryGlyph } from '../listings/CategoryGlyph';
import { ListingCard } from '../listings/ListingCard';
import { Photo } from '../listings/Photo';
import { PlotMap } from '../farmer/PlotMap';
import { LanguageButtons } from '../farmer/LanguageSwitch';
import { PasswordInput } from '../ui';
import {
  FARMS,
  FARMER_FIXTURE_PASSWORD,
  FARMER_LOGIN_PHONES,
  FARMER_NUMBER_FORMAT,
  LISTINGS,
  LISTING_CATEGORIES,
  farmerById,
} from '@/lib/fixtures/farmers';
import { CATEGORY_LABELS } from '@/lib/farmers/listings';
import { formatPhone } from '@/lib/format';
import type { Language } from '@/lib/i18n';
import * as Icons from '../ui/icons';
import styles from './design.module.css';
import farmer from '../farmer/farmer.module.css';
import listings from '../listings/listings.module.css';

const GOOD_FARM = FARMS.find((f) => f.boundary && f.accuracy_flag === 'good') ?? FARMS[0]!;
const UNUSABLE_FARM = FARMS.find((f) => f.accuracy_flag === 'unusable') ?? FARMS[0]!;
const MAP_FARMS = FARMS.filter((f) => f.farmer_id === GOOD_FARM.farmer_id);

/**
 * The design system, rendered from the same tokens and components the
 * screens use. If a component here looks wrong, it is wrong everywhere; there
 * is no second copy to drift. Source: the client's design document, September
 * 2026.
 */

const PALETTE = [
  { name: 'paper', hex: '#F5F7F1', use: 'Ground. The pale field the whole product sits on.' },
  { name: 'card', hex: '#FFFFFF', use: 'Raised surfaces: cards, inputs, menus.' },
  { name: 'dust', hex: '#E9EDE3', use: 'Wells, insets, skeletons, disabled fills. Never text.' },
  { name: 'line', hex: '#D6DCCF', use: 'Hairline rule. Carries most of the structure.' },
  { name: 'line-strong', hex: '#AEB8A6', use: 'Structural rule, strong border, section heads.' },
  { name: 'ink', hex: '#132A1C', use: 'Forest. Primary text and headings.' },
  { name: 'ink-2', hex: '#3B4F41', use: 'Secondary text, body copy on cards.' },
  { name: 'muted', hex: '#5E6C60', use: 'Captions, helper text, labels. 5.1:1 on paper.' },
  { name: 'green-deep', hex: '#14532D', use: 'Placeholder words, the public spread, deep fills.' },
  {
    name: 'green',
    hex: '#1F7A3F',
    use: 'Primary buttons, links, the active tab rule, the focus ring.',
  },
  { name: 'green-hover', hex: '#165F31', use: 'Primary button hover.' },
  { name: 'sprout', hex: '#7CB342', use: 'Highlights, success, the tittle on the wordmark.' },
  { name: 'green-tint', hex: '#E4F1E3', use: 'Selected rows, photo placeholders, soft fills.' },
  {
    name: 'harvest',
    hex: '#E0A526',
    use: 'Harvest gold, fills only: List it, sold stamps, KPI rules. Never text on white.',
  },
  { name: 'harvest-deep', hex: '#B8841A', use: 'Harvest gold as large text: KPI figures.' },
  {
    name: 'harvest-ink',
    hex: '#8F6E1B',
    use: 'Harvest gold as small text: prices on cards and product pages, 4.8:1.',
  },
  { name: 'harvest-tint', hex: '#FBF0D2', use: 'Gold tint behind a price or a sold mark.' },
  { name: 'soil', hex: '#6B4A2B', use: 'Earth. Secondary buttons and moderation surfaces.' },
  { name: 'soil-tint', hex: '#EFE6DB', use: 'Earth tint for secondary surfaces.' },
  { name: 'clay', hex: '#A32D1E', use: 'Danger. Rejected, errors, destructive outline.' },
  { name: 'verified', hex: '#2E7D32', use: 'Verified stamp and its tint #DFF0DF.' },
  { name: 'pending', hex: '#9A6B0F', use: 'Pending and escalated stamps, tint #F6EBCC.' },
  { name: 'danger', hex: '#A32D1E', use: 'Rejected stamp, tint #F5DCD7.' },
  { name: 'info', hex: '#1D5A85', use: 'Information notices and sold, tint #DCE8F1.' },
  { name: 'neutral', hex: '#55625B', use: 'Draft, merged, neutral facts, tint #E4E7E2.' },
  { name: 'band', hex: '#0F2E1C', use: 'The masthead band and the public spread panel.' },
] as const;

const TYPE = [
  {
    name: 'Display 32 / 800',
    sample: 'Directories',
    style: {
      fontFamily: 'var(--font-display)',
      fontSize: 32,
      fontWeight: 800,
      letterSpacing: '-0.02em',
    },
  },
  {
    name: 'Heading 22 / 700',
    sample: 'Agro-dealers, suppliers and financial services',
    style: { fontFamily: 'var(--font-display)', fontSize: 22, fontWeight: 700 },
  },
  {
    name: 'Subhead 16 / 700',
    sample: 'Contact and location',
    style: { fontFamily: 'var(--font-display)', fontSize: 16, fontWeight: 700 },
  },
  {
    name: 'Body 15 / 400',
    sample: 'Where an officer sends a farmer for seed, fertiliser, tools, savings or a loan.',
    style: { fontSize: 15 },
  },
  {
    name: 'Small 13 / 400',
    sample: 'Last checked 20 Aug 2026, 13 days ago.',
    style: { fontSize: 13, color: 'var(--muted)' },
  },
  {
    name: 'LABEL 11 / 600',
    sample: 'PHONE · LAST CHECKED · SERVICES',
    style: {
      fontFamily: 'var(--font-body)',
      fontSize: 11,
      fontWeight: 600,
      letterSpacing: '0.08em',
      textTransform: 'uppercase' as const,
      color: 'var(--muted)',
    },
  },
  {
    name: 'Mono / numbers',
    sample: 'CE-JUB-000123 · +211 92 884 1107 · 1.84 ha',
    style: {
      fontFamily: 'var(--font-mono)',
      fontSize: 18,
      fontVariantNumeric: 'tabular-nums',
    },
  },
] as const;

const ICONS: Array<[string, (p: { size?: number }) => React.JSX.Element]> = [
  ['search', Icons.IconSearch],
  ['plus', Icons.IconPlus],
  ['check', Icons.IconCheck],
  ['x', Icons.IconX],
  ['warn', Icons.IconWarn],
  ['info', Icons.IconInfo],
  ['phone', Icons.IconPhone],
  ['mail', Icons.IconMail],
  ['pin', Icons.IconPin],
  ['edit', Icons.IconEdit],
  ['remove', Icons.IconRemove],
  ['print', Icons.IconPrint],
  ['upload', Icons.IconUpload],
  ['external', Icons.IconExternal],
  ['eye', Icons.IconEye],
  ['eye-off', Icons.IconEyeOff],
  ['dashboard', Icons.IconDashboard],
  ['farmers', Icons.IconFarmers],
  ['directory', Icons.IconDirectory],
  ['library', Icons.IconLibrary],
  ['palette', Icons.IconPalette],
  ['pdf', Icons.IconPdf],
  ['image', Icons.IconImage],
  ['audio', Icons.IconAudio],
  ['video', Icons.IconVideo],
];

const SECTIONS = [
  ['palette', 'Palette'],
  ['type', 'Type'],
  ['shape', 'Shape and spacing'],
  ['buttons', 'Buttons'],
  ['badges', 'Badges'],
  ['stamps', 'Stamps'],
  ['sync', 'Sync chips'],
  ['boundary', 'Farm boundary'],
  ['numbering', 'Farmer number'],
  ['fields', 'Fields'],
  ['tabs', 'Tabs and search'],
  ['states', 'Empty, error and notice states'],
  ['cards', 'Cards and skeletons'],
  ['dialog', 'Dialog'],
  ['icons', 'Icons'],
  ['brand', 'Wordmark'],
  ['listings', 'Listings and photos'],
  ['market', 'Marketplace'],
  ['survey', 'Farm survey map'],
  ['farmer', 'Farmer flow'],
  ['rules', 'Rules'],
] as const;

export function DesignPage() {
  const [tab, setTab] = useState<'all' | 'a' | 'b'>('all');
  const [dialogOpen, setDialogOpen] = useState(false);
  const [designLang, setDesignLang] = useState<Language>('en');

  return (
    <div className={styles.page}>
      <PageHeader
        eyebrow="Reference"
        title="Design system"
        subtitle="Tokens, components and rules from the client's design document, rendered live. Every screen in the portal is built from exactly these."
        actions={
          <Button variant="ghost" onClick={() => window.print()}>
            <Icons.IconPrint size={18} />
            Print
          </Button>
        }
      />

      <nav className={`${styles.toc} no-print`} aria-label="On this page">
        {SECTIONS.map(([id, label]) => (
          <a key={id} href={`#${id}`}>
            {label}
          </a>
        ))}
      </nav>

      <section id="palette" className={styles.section} aria-labelledby="h-palette">
        <div className={styles.sectionHead}>
          <h2 id="h-palette">Palette</h2>
          <p>
            AgriOne reads as agriculture: a pale field ground, forest ink, growing green as the
            action colour with sprout for highlights, harvest gold as the second accent for prices
            and sales, and earth for secondary surfaces. Structure is carried by the two rule
            tokens, not by fills or shadow. Every text pairing is at or above 4.5:1; amber text on
            white is not allowed — harvest-deep carries gold as text, harvest as a fill. Dust is a
            fill and never a text colour.
          </p>
        </div>
        <div className={styles.swatches}>
          {PALETTE.map((c) => (
            <div key={c.name} className={styles.swatch}>
              <div className={styles.swatchChip} style={{ background: `var(--${c.name})` }} />
              <div>
                <div className={styles.swatchName}>{c.name}</div>
                <div className={styles.swatchHex}>{c.hex}</div>
                <div className="small muted">{c.use}</div>
              </div>
            </div>
          ))}
        </div>
      </section>

      <section id="type" className={styles.section} aria-labelledby="h-type">
        <div className={styles.sectionHead}>
          <h2 id="h-type">Type</h2>
          <p>
            Fraunces for display and headings (optical size, soft and wonk axes set for a warm,
            editorial masthead); Instrument Sans for body text and labels; JetBrains Mono for every
            number, code and farmer number, in tabular figures. The faces load through
            next/font/google in the layout, with system fallback stacks until they arrive.
          </p>
        </div>
        <Card padded as="div">
          {TYPE.map((t) => (
            <div key={t.name} className={styles.typeRow}>
              <span className="small muted">{t.name}</span>
              <span style={t.style}>{t.sample}</span>
            </div>
          ))}
        </Card>
      </section>

      <section id="shape" className={styles.section} aria-labelledby="h-shape">
        <div className={styles.sectionHead}>
          <h2 id="h-shape">Shape and spacing</h2>
          <p>
            Near-square: cards 4px radius, controls 2px. No pills — the register is ruled, not
            rounded. Every interactive element is at least 40×40. Spacing steps: 4, 8, 12, 16, 20,
            24, 32, 40.
          </p>
        </div>
        <div className={styles.shapeRow}>
          <div className={styles.shape}>
            <div className={styles.shapeBox} style={{ borderRadius: 4 }} />
            card · 4px
          </div>
          <div className={styles.shape}>
            <div className={styles.shapeBox} style={{ borderRadius: 2 }} />
            control · 2px
          </div>
          <div className={styles.shape}>
            <div
              className={styles.shapeBox}
              style={{ width: 40, height: 40, borderRadius: 2, borderStyle: 'dashed' }}
            />
            touch · 40px
          </div>
        </div>
      </section>

      <section id="buttons" className={styles.section} aria-labelledby="h-buttons">
        <div className={styles.sectionHead}>
          <h2 id="h-buttons">Buttons</h2>
          <p>
            One primary per view. Destructive actions are outlined in clay, never filled, and always
            confirm with a reason. Disabled uses dust with muted text.
          </p>
        </div>
        <Card padded as="div">
          <div className={styles.row}>
            <Button>
              <Icons.IconPlus size={18} />
              Primary
            </Button>
            <Button variant="secondary">Secondary</Button>
            <Button variant="ghost">Ghost</Button>
            <Button variant="danger">
              <Icons.IconRemove size={18} />
              Destructive
            </Button>
            <Button disabled>Disabled</Button>
            <Button size="small">Small</Button>
            <Button variant="secondary" size="small">
              Small secondary
            </Button>
            <Button iconOnly aria-label="Search" variant="secondary">
              <Icons.IconSearch />
            </Button>
          </div>
        </Card>
      </section>

      <section id="badges" className={styles.section} aria-labelledby="h-badges">
        <div className={styles.sectionHead}>
          <h2 id="h-badges">Badges</h2>
          <p>
            Status is always a word, never only a colour. Filled for the record's state, outlined
            for secondary facts.
          </p>
        </div>
        <Card padded as="div">
          <div className={styles.row} style={{ marginBottom: 'var(--s-3)' }}>
            <Badge tone="leaf" dot>
              Verified
            </Badge>
            <Badge tone="sorghum" dot>
              Pending
            </Badge>
            <Badge tone="clay" dot>
              Rejected
            </Badge>
            <Badge tone="nile">PDF</Badge>
            <Badge tone="neutral">Bank</Badge>
          </div>
          <div className={styles.row}>
            <Badge tone="leaf" outline dot>
              Checked 20 Aug 2026
            </Badge>
            <Badge tone="sorghum" outline dot>
              Not checked for 203 days
            </Badge>
            <Badge tone="clay" outline>
              Inactive
            </Badge>
            <Badge tone="nile" outline>
              Arabi Juba
            </Badge>
            <Badge tone="neutral" outline>
              Draft
            </Badge>
          </div>
        </Card>
      </section>

      <section id="stamps" className={styles.section} aria-labelledby="h-stamps">
        <div className={styles.sectionHead}>
          <h2 id="h-stamps">Stamps</h2>
          <p>
            A farmer&apos;s state, stamped like an inspector&apos;s mark: a ruled inset with an ink
            and a tint from the status tokens. The word carries the meaning; escalated is a pending
            wait gone past seven days.
          </p>
        </div>
        <Card padded as="div">
          <div className={styles.row}>
            <Stamp kind="verified">Verified</Stamp>
            <Stamp kind="pending">Pending</Stamp>
            <Stamp kind="escalated">Escalated</Stamp>
            <Stamp kind="rejected">Rejected</Stamp>
            <Stamp kind="merged">Merged</Stamp>
            <Stamp kind="info">Self-registered</Stamp>
            <Stamp kind="neutral">Draft</Stamp>
          </div>
        </Card>
      </section>

      <section id="sync" className={styles.section} aria-labelledby="h-sync">
        <div className={styles.sectionHead}>
          <h2 id="h-sync">Sync chips</h2>
          <p>
            Where a record is on its way up from the field. Offline-first: a row can be waiting or
            sending, and a failed upload keeps a reason on the device rather than dropping the
            record.
          </p>
        </div>
        <Card padded as="div">
          <div className={styles.row}>
            <SyncChip status="synced" />
            <SyncChip status="sending" />
            <SyncChip status="waiting" />
            <SyncChip status="failed" />
          </div>
        </Card>
      </section>

      <section id="boundary" className={styles.section} aria-labelledby="h-boundary">
        <div className={styles.sectionHead}>
          <h2 id="h-boundary">Farm boundary</h2>
          <p>
            The walked plot, drawn as an inline SVG polygon straight from the fixture GeoJSON — no
            map library, no tiles, no network. Two sizes: 96px in the register table, 360px in the
            dossier. A plot with no usable trace says so in the same box rather than drawing a shape
            that would lie about the land.
          </p>
        </div>
        <Card padded as="div">
          <div className={styles.row} style={{ alignItems: 'flex-start', gap: 'var(--s-8)' }}>
            <div style={{ display: 'grid', gap: 'var(--s-2)', justifyItems: 'center' }}>
              <Boundary farm={GOOD_FARM} size={96} />
              <span className="small muted">96px · table</span>
            </div>
            <div style={{ display: 'grid', gap: 'var(--s-2)', justifyItems: 'center' }}>
              <Boundary farm={GOOD_FARM} size={360} showArea={false} />
              <span className="small muted">360px · dossier</span>
            </div>
            <div style={{ display: 'grid', gap: 'var(--s-2)', justifyItems: 'center' }}>
              <Boundary farm={UNUSABLE_FARM} size={96} />
              <span className="small muted">unusable · no trace</span>
            </div>
          </div>
        </Card>
      </section>

      <section id="numbering" className={styles.section} aria-labelledby="h-numbering">
        <div className={styles.sectionHead}>
          <h2 id="h-numbering">Farmer number</h2>
          <p>
            Every farmer carries a human-readable number, shown in mono everywhere. The format below
            is a placeholder: the numbering rule (C-5) has not been written, so nothing here mints a
            real number.
          </p>
        </div>
        <Card padded as="div">
          <p className="mono" style={{ fontSize: 18 }}>
            {FARMER_NUMBER_FORMAT}
          </p>
          <p className="small muted" style={{ marginTop: 'var(--s-3)' }}>
            state · county · sequence. Fixture rows use this shape so the screens read correctly;
            the real sequence, check digit and reset rule are C-5&apos;s to decide.
          </p>
        </Card>
      </section>

      <section id="fields" className={styles.section} aria-labelledby="h-fields">
        <div className={styles.sectionHead}>
          <h2 id="h-fields">Fields</h2>
          <p>
            Label above, hint below, error below the hint in clay with an icon. Error text is the
            shared schema's own sentence. Every control is 48px tall and 14px rounded.
          </p>
        </div>
        <Card padded as="div">
          <div className={styles.grid2}>
            <Field label="Name" hint="As a farmer would know it.">
              {(ids) => <Input {...ids} defaultValue="Juba Agro Supplies" dir="auto" />}
            </Field>
            <Field
              label="Phone"
              error="A South Sudan mobile number has nine digits after +211. This one has too few."
            >
              {(ids) => (
                <PrefixedInput {...ids} prefix="+211" defaultValue="92 884" inputMode="tel" />
              )}
            </Field>
            <Field label="Payam">
              {(ids) => (
                <Select {...ids} defaultValue="CE-JUB-REJ">
                  <option value="CE-JUB-KAT">Kator Payam</option>
                  <option value="CE-JUB-REJ">Rejaf Payam</option>
                </Select>
              )}
            </Field>
            <Field label="Storage path" hint="Filled in by the upload.">
              {(ids) => (
                <Input {...ids} defaultValue="pdf/2026/sorghum-planting-guide.pdf" readOnly />
              )}
            </Field>
            <Field label="Description" optional>
              {(ids) => (
                <Textarea
                  {...ids}
                  placeholder="What an officer reads before deciding to download."
                />
              )}
            </Field>
            <div style={{ display: 'grid', gap: 'var(--s-2)' }}>
              <Field label="Disabled">
                {(ids) => <Input {...ids} defaultValue="Cannot be changed here" disabled />}
              </Field>
              <Checkbox label="Published — visible to officers" defaultChecked />
            </div>
          </div>
        </Card>
      </section>

      <section id="tabs" className={styles.section} aria-labelledby="h-tabs">
        <div className={styles.sectionHead}>
          <h2 id="h-tabs">Tabs and search</h2>
          <p>Tabs carry counts. Search has a visible icon and a hidden label for screen readers.</p>
        </div>
        <Card padded as="div">
          <div className={styles.row}>
            <Tabs
              label="Example"
              items={[
                { key: 'all', label: 'All', count: 14 },
                { key: 'a', label: 'Agro-dealers', count: 5 },
                { key: 'b', label: 'Financial services', count: 5 },
              ]}
              value={tab}
              onChange={setTab}
            />
            <div style={{ flex: '1 1 280px', maxWidth: 420 }}>
              <SearchInput label="Search" placeholder="Search name, phone, service…" />
            </div>
          </div>
        </Card>
      </section>

      <section id="states" className={styles.section} aria-labelledby="h-states">
        <div className={styles.sectionHead}>
          <h2 id="h-states">Empty, error and notice states</h2>
          <p>
            Every state names what happened and what to do next, in that order, and the next step is
            a real button.
          </p>
        </div>
        <div className={styles.grid2}>
          <EmptyState
            title="No entries match “Majika Deng”"
            body="Try the whole county, check the spelling, or search by phone number."
            actions={<Button variant="secondary">Search all of Juba County</Button>}
          />
          <EmptyState
            error
            title="The list could not be loaded"
            body="The connection dropped before the server answered. Your filters are kept."
            actions={<Button>Try again</Button>}
          />
          <Notice kind="success" title="Saved">
            Validated with the shared schema and written to the record with who and when.
          </Notice>
          <Notice kind="warn" title="Possible duplicate, check before saving">
            A verified farmer with the same phone number exists. Phones are sometimes shared within
            a household; this warns, it never blocks.
          </Notice>
          <Notice kind="info" title="41.0 MB on a metered connection">
            Large file. Download it on Wi-Fi at the office before going to the field.
          </Notice>
          <Notice kind="error" title="The entry cannot be saved yet">
            Fix the two fields marked below. Nothing has been saved.
          </Notice>
        </div>
      </section>

      <section id="cards" className={styles.section} aria-labelledby="h-cards">
        <div className={styles.sectionHead}>
          <h2 id="h-cards">Cards and skeletons</h2>
          <p>Cards are white on paper with one soft shadow. Skeletons are dust and pulse slowly.</p>
        </div>
        <div className={styles.grid2}>
          <Card>
            <CardHeader
              title="Card with header"
              subtitle="Subtitle in small muted"
              actions={
                <Button size="small" variant="secondary">
                  Action
                </Button>
              }
            />
            <CardBody>
              <div className={styles.row}>
                <Avatar text="JA" tone="leaf" />
                <Avatar text="ES" tone="nile" />
                <Avatar text="EB" tone="sorghum" />
                <Avatar text="NA" />
                <Chips items={['seeds', 'fertiliser', 'hand tools']} />
              </div>
            </CardBody>
          </Card>
          <Card padded as="div" aria-label="Loading example">
            <div style={{ display: 'grid', gap: 12 }}>
              <div className={styles.row}>
                <Skeleton width={44} height={44} />
                <div style={{ flex: 1, display: 'grid', gap: 8 }}>
                  <Skeleton width="60%" />
                  <Skeleton width="40%" height={12} />
                </div>
              </div>
              <Skeleton height={12} />
              <Skeleton height={12} width="80%" />
            </div>
          </Card>
        </div>
      </section>

      <section id="dialog" className={styles.section} aria-labelledby="h-dialog">
        <div className={styles.sectionHead}>
          <h2 id="h-dialog">Dialog</h2>
          <p>
            Native dialog: focus trap, Escape and backdrop from the browser. Destructive
            confirmations include a reason field that stays on the record.
          </p>
        </div>
        <Card padded as="div">
          <Button variant="danger" onClick={() => setDialogOpen(true)}>
            <Icons.IconRemove size={18} />
            Open remove dialog
          </Button>
        </Card>
        <Dialog
          open={dialogOpen}
          onClose={() => setDialogOpen(false)}
          title="Remove Kator Old Market Stall?"
          footer={
            <>
              <Button variant="ghost" onClick={() => setDialogOpen(false)}>
                Keep entry
              </Button>
              <Button variant="danger" onClick={() => setDialogOpen(false)}>
                Remove entry
              </Button>
            </>
          }
        >
          <p>
            The entry becomes inactive. It is not deleted; the record and your reason stay in the
            audit trail.
          </p>
          <Field label="Reason">{(ids) => <Textarea {...ids} rows={3} />}</Field>
        </Dialog>
      </section>

      <section id="icons" className={styles.section} aria-labelledby="h-icons">
        <div className={styles.sectionHead}>
          <h2 id="h-icons">Icons</h2>
          <p>
            Twenty-five inline icons on a 24 grid, 1.75 stroke. They are decorative: every icon in
            the portal sits next to a visible word.
          </p>
        </div>
        <div className={styles.icons}>
          {ICONS.map(([name, Icon]) => (
            <div key={name} className={styles.icon}>
              <Icon />
              {name}
            </div>
          ))}
        </div>
      </section>

      <section id="brand" className={styles.section} aria-labelledby="h-brand">
        <div className={styles.sectionHead}>
          <h2 id="h-brand">Wordmark</h2>
          <p>
            AgriOne in Fraunces: &ldquo;Agri&rdquo; regular, &ldquo;One&rdquo; semibold, the tittle
            on the i drawn in sprout. Drawn from type and one CSS dot, never an image. The tagline
            sits beneath it in 11px letter-spaced caps. On the band the wordmark inverts to
            band-ink; the tittle stays sprout. Minimum size 18px; never stretched, recoloured or
            placed on a photograph.
          </p>
        </div>
        <div className={styles.row} style={{ alignItems: 'flex-end', gap: 'var(--s-7)' }}>
          <Wordmark size={40} tagline />
          <Wordmark size={22} tagline />
          <Wordmark size={18} />
          <span
            style={{
              background: 'var(--band)',
              padding: 'var(--s-4) var(--s-5)',
              borderRadius: 'var(--radius-card)',
            }}
          >
            <Wordmark size={28} tagline onBand />
          </span>
        </div>
      </section>

      <section id="listings" className={styles.section} aria-labelledby="h-listings">
        <div className={styles.sectionHead}>
          <h2 id="h-listings">Listings and photos</h2>
          <p>
            A marketplace card: cover photo in a 4:3 frame with a hairline, category, title, the
            price in mono as &ldquo;SSP 1,250 / 50 kg bag&rdquo;, the quantity, the seller with
            their verification stamp and payam. A missing photo is a tokenised placeholder that
            names the category — never a broken image. Each category has one 16px glyph in a single
            colour, always beside its word.
          </p>
        </div>
        <div className={styles.grid2}>
          <div className={listings.grid}>
            {LISTINGS.filter((l) => l.status === 'listed')
              .slice(0, 2)
              .map((l) => (
                <ListingCard
                  key={l.id}
                  listing={l}
                  lang="en"
                  href="#listings"
                  seller={farmerById(l.farmer_id)}
                />
              ))}
          </div>
          <div>
            <p className="small muted">Photo placeholder, 4:3 and square</p>
            <div className={styles.row}>
              <div style={{ width: 200 }}>
                <Photo src={null} category="vegetable" lang="en" />
              </div>
              <div style={{ width: 120 }}>
                <Photo src={null} category="livestock" lang="en" square />
              </div>
            </div>
            <p className="small muted" style={{ marginTop: 'var(--s-5)' }}>
              Category glyphs
            </p>
            <div className={styles.row}>
              {LISTING_CATEGORIES.map((c) => (
                <span key={c} className={styles.icon}>
                  <CategoryGlyph category={c} />
                  {CATEGORY_LABELS[c]}
                </span>
              ))}
            </div>
            <p className="small muted" style={{ marginTop: 'var(--s-5)' }}>
              Listing status
            </p>
            <div className={styles.row}>
              <Stamp kind="neutral">Draft</Stamp>
              <Stamp kind="verified">Listed</Stamp>
              <Stamp kind="merged">Withdrawn</Stamp>
              <Stamp kind="info">Sold</Stamp>
            </div>
          </div>
        </div>
      </section>

      <section id="market" className={styles.section} aria-labelledby="h-market">
        <div className={styles.sectionHead}>
          <h2 id="h-market">Marketplace</h2>
          <p>
            The browse chrome: a 48px search field with a submit glyph, a category chip strip whose
            active chip fills green with band ink, and the two price sizes &mdash; 20px mono on the
            card, 28px mono on the product page. Prices read in ink; the unit follows in muted.
          </p>
        </div>

        <p className="small muted">Search field</p>
        <form className={listings.searchField} role="search" onSubmit={(e) => e.preventDefault()}>
          <Icons.IconSearch size={20} />
          <input
            type="search"
            placeholder="Search produce, livestock, inputs…"
            aria-label="Search the marketplace"
            readOnly
          />
          <button type="submit" className={listings.searchSubmit} aria-label="Search">
            <Icons.IconSearch size={18} />
          </button>
        </form>

        <p className="small muted" style={{ marginTop: 'var(--s-5)' }}>
          Category chip strip
        </p>
        <div className={listings.chipStrip} role="group" aria-label="Category">
          <button type="button" className={listings.chip} aria-pressed>
            All produce
          </button>
          {LISTING_CATEGORIES.slice(0, 4).map((c) => (
            <button key={c} type="button" className={listings.chip} aria-pressed={false}>
              <CategoryGlyph category={c} size={15} />
              {CATEGORY_LABELS[c]}
            </button>
          ))}
        </div>

        <p className="small muted" style={{ marginTop: 'var(--s-5)' }}>
          Price &mdash; card (20) and product (28)
        </p>
        <div className={styles.row}>
          <div className={listings.cardPrice}>
            SSP 1,250 <small>/ 50 kg bag</small>
          </div>
          <div className={listings.productPrice}>
            <span>SSP 1,250</span>
            <small>/ 50 kg bag</small>
            <span className={listings.negChip}>Negotiable</span>
          </div>
        </div>
      </section>

      <section id="survey" className={styles.section} aria-labelledby="h-survey">
        <div className={styles.sectionHead}>
          <h2 id="h-survey">Farm survey map</h2>
          <p>
            The farmer&rsquo;s whole holding on one survey map: every walked plot fitted into a
            single frame &mdash; longitude compressed by the cosine of the latitude &mdash; with a
            north arrow, a metric scale bar read from the extents, and each plot&rsquo;s hectares
            stamped in mono at its centroid. No map library, no tiles, no network.
          </p>
        </div>
        <div className={farmer.surveyMap} style={{ maxWidth: 520 }}>
          <PlotMap farms={MAP_FARMS} selectedId={MAP_FARMS[0]?.id} lang="en" />
        </div>
      </section>

      <section id="farmer" className={styles.section} aria-labelledby="h-farmer">
        <div className={styles.sectionHead}>
          <h2 id="h-farmer">Farmer flow</h2>
          <p>
            The farmer&apos;s screens use the same tokens at a larger control (48px) and fewer words
            per view. Language is a two-button switch in the masthead; sign-in is phone and
            password; the farmer number reads as an em dash until it is assigned. Section rules on
            the farmer side are a double hairline in sprout.
          </p>
        </div>
        <Card padded as="div">
          <div className={farmer.scope} style={{ background: 'transparent' }}>
            <p className="small muted">Language switch</p>
            <div className={farmer.compactBand} style={{ display: 'flex' }}>
              <Wordmark size={20} />
              <LanguageButtons value={designLang} onChange={setDesignLang} />
            </div>

            <div className={styles.grid2} style={{ marginTop: 'var(--s-5)' }}>
              <Field label="Phone">
                {(ids) => (
                  <PrefixedInput
                    {...ids}
                    prefix="+211"
                    inputMode="tel"
                    defaultValue="92 000 0000"
                  />
                )}
              </Field>
              <Field label="Password">
                {(ids) => (
                  <PasswordInput
                    {...ids}
                    defaultValue="password"
                    showLabel="Show"
                    hideLabel="Hide"
                  />
                )}
              </Field>
            </div>

            <div className={farmer.pageHead} style={{ marginTop: 'var(--s-5)' }}>
              <div className={farmer.pageTitle}>
                <h3>Overview</h3>
                <p className={farmer.pageLead}>A farmer-side page head with its double rule.</p>
              </div>
            </div>

            <dl className={farmer.recordRows}>
              <div className={farmer.recordRow}>
                <dt className={farmer.recordTerm}>Farmer no.</dt>
                <dd className={farmer.recordValueMono}>
                  —
                  <span className={farmer.recordNote}>
                    Assigned when your registration is verified.
                  </span>
                </dd>
              </div>
              <div className={farmer.recordRow}>
                <dt className={farmer.recordTerm}>Farmer no.</dt>
                <dd className={farmer.recordValueMono}>{FARMER_NUMBER_FORMAT}</dd>
              </div>
            </dl>

            <Notice kind="info" title="Fixture sign-in (this page only)">
              <p className="small">
                Until the auth route lands, these fixture numbers sign in with the password{' '}
                <code className="mono">{FARMER_FIXTURE_PASSWORD}</code>:
              </p>
              <ul className="small">
                {FARMER_LOGIN_PHONES.map((f) => (
                  <li key={f.phone}>
                    <span className="mono">{formatPhone(f.phone)}</span> — {f.who}
                  </li>
                ))}
              </ul>
            </Notice>
          </div>
        </Card>
      </section>

      <section id="rules" className={styles.section} aria-labelledby="h-rules">
        <div className={styles.sectionHead}>
          <h2 id="h-rules">Rules</h2>
        </div>
        <ul className={styles.rules}>
          <li>
            <strong>Tokens only.</strong> No hex value outside globals.css. A new colour is a design
            decision, not a CSS edit.
          </li>
          <li>
            <strong>Every icon has a label.</strong> Icon-only buttons carry aria-label and are the
            exception, not the pattern.
          </li>
          <li>
            <strong>Status is a word.</strong> Colour reinforces it; it never carries the meaning
            alone.
          </li>
          <li>
            <strong>Destructive is outlined and confirmed.</strong> Never a filled red button,
            always a reason field, never a hard delete.
          </li>
          <li>
            <strong>States say what happened and what to do.</strong> Empty, error and success copy
            names the situation and offers the next step as a button.
          </li>
          <li>
            <strong>Numbers are JetBrains Mono, tabular.</strong> Phone numbers, farmer numbers,
            counts, sizes and dates line up in columns.
          </li>
          <li>
            <strong>User text is bidirectional.</strong> Anything a person typed renders with
            dir="auto" so Arabi Juba reads correctly.
          </li>
          <li>
            <strong>Validation is shared.</strong> Forms run the Zod schema from packages/shared and
            show its messages verbatim; the API says the same thing.
          </li>
          <li>
            <strong>Print is the record.</strong> Navigation, role switcher and actions do not
            print; the list or detail being read does, on white, with ruled cards.
          </li>
        </ul>
      </section>
    </div>
  );
}
