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
import { Boundary } from '../farmers/Boundary';
import { FARMS, FARMER_NUMBER_FORMAT } from '@/lib/fixtures/farmers';
import * as Icons from '../ui/icons';
import styles from './design.module.css';

const GOOD_FARM = FARMS.find((f) => f.boundary && f.accuracy_flag === 'good') ?? FARMS[0]!;
const UNUSABLE_FARM = FARMS.find((f) => f.accuracy_flag === 'unusable') ?? FARMS[0]!;

/**
 * The design system, rendered from the same tokens and components the
 * screens use. If a component here looks wrong, it is wrong everywhere; there
 * is no second copy to drift. Source: the client's design document, September
 * 2026.
 */

const PALETTE = [
  { name: 'paper', hex: '#F3EEE3', use: 'Ground. The bone paper the register sits on.' },
  { name: 'card', hex: '#FBF8F1', use: 'Raised surfaces: cards, inputs, menus.' },
  { name: 'dust', hex: '#EAE3D3', use: 'Wells, insets, skeletons, disabled fills. Never text.' },
  { name: 'line', hex: '#D9D0BC', use: 'Hairline rule. Carries most of the structure.' },
  { name: 'line-strong', hex: '#B9AE95', use: 'Structural rule, strong border, section heads.' },
  { name: 'ink', hex: '#12261B', use: 'Forest. Primary text and headings.' },
  { name: 'ink-2', hex: '#3E4F44', use: 'Secondary text, body copy on cards.' },
  { name: 'muted', hex: '#6F7D73', use: 'Captions, helper text, labels.' },
  { name: 'accent', hex: '#D8811A', use: 'Harvest amber. The one action colour; rare on purpose.' },
  { name: 'verified', hex: '#1F6B3A', use: 'Verified stamp and its tint fill.' },
  { name: 'pending', hex: '#8A5A0B', use: 'Pending and escalated stamps.' },
  { name: 'danger', hex: '#9B2C1E', use: 'Rejected, errors, destructive outline.' },
  { name: 'info', hex: '#1E4E79', use: 'Information notices and merged links.' },
  { name: 'neutral', hex: '#4F5B63', use: 'Draft, neutral facts.' },
  { name: 'band', hex: '#0F1F16', use: 'The masthead band only.' },
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
  ['rules', 'Rules'],
] as const;

export function DesignPage() {
  const [tab, setTab] = useState<'all' | 'a' | 'b'>('all');
  const [dialogOpen, setDialogOpen] = useState(false);

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
            &ldquo;The Register&rdquo;: a bone-paper ground, forest ink, and harvest amber as the
            one action colour, used rarely. Structure is carried by the two rule tokens, not by
            fills or shadow. Contrast is pushed past WCAG AA because the portal is read in sunlight.
            Dust is a fill and never a text colour.
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
            Near-square: cards 4px radius, controls 2px. No pills; the register is ruled, not
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
              Arabic
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
            The walked plot, drawn as an inline SVG polygon straight from the fixture GeoJSON: no
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
              <Checkbox label="Published, visible to officers" defaultChecked />
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
            dir="auto" so Arabic reads correctly.
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
