'use client';

import { useState } from 'react';

import type { DirectoryEntryRow } from '@/lib/fixtures/p1';
import { payamName } from '@/lib/fixtures/p1';
import {
  ENTRY_TYPE_LABELS,
  PROVIDER_CLASS_LABELS,
  formatDate,
  formatPhone,
  monogram,
} from '@/lib/format';
import { canEdit, usePreview } from '@/lib/preview';

import {
  Avatar,
  Badge,
  Button,
  ButtonLink,
  Card,
  Chips,
  DefinitionList,
  Dialog,
  Field,
  Notice,
  Textarea,
} from '../ui';
import {
  IconEdit,
  IconExternal,
  IconMail,
  IconPhone,
  IconPin,
  IconPrint,
  IconRemove,
} from '../ui/icons';
import styles from '../screens.module.css';
import { TYPE_TONE, freshness } from './entry-presentation';

/**
 * One directory entry, read in full. Phone and email are real links because
 * the most common thing an officer does here is call. Removal is soft, needs
 * a reason, and the reason stays on the record.
 */
export function EntryDetail({ entry }: { entry: DirectoryEntryRow }) {
  const { role, removeEntry, hydrated } = usePreview();
  const [confirming, setConfirming] = useState(false);
  const [reason, setReason] = useState('');
  const [reasonError, setReasonError] = useState<string>();
  const [removed, setRemoved] = useState(false);

  const fresh = freshness(entry);
  const editor = hydrated && canEdit(role);
  const headingId = `entry-${entry.id}`;

  async function confirmRemove() {
    if (reason.trim().length < 5) {
      setReasonError('Say why this entry is being removed, in a few words.');
      return;
    }
    try {
      await removeEntry(entry.id, reason.trim());
    } catch (e) {
      setReasonError(e instanceof Error ? e.message : 'The entry could not be removed.');
      return;
    }
    setConfirming(false);
    setRemoved(true);
    setReason('');
    setReasonError(undefined);
  }

  const mapHref = entry.location
    ? `https://www.openstreetmap.org/?mlat=${entry.location.latitude}&mlon=${entry.location.longitude}#map=16/${entry.location.latitude}/${entry.location.longitude}`
    : null;

  return (
    <Card as="article" aria-labelledby={headingId}>
      <div className={styles.detailHead}>
        <Avatar text={monogram(entry.name)} tone={TYPE_TONE[entry.entry_type]} large />
        <div className={styles.detailTitle}>
          <div className={styles.detailBadges}>
            <Badge tone={TYPE_TONE[entry.entry_type]}>{ENTRY_TYPE_LABELS[entry.entry_type]}</Badge>
            {entry.provider_class ? (
              <Badge tone="neutral">{PROVIDER_CLASS_LABELS[entry.provider_class]}</Badge>
            ) : null}
            {entry.active ? (
              <Badge tone={fresh.tone} outline={fresh.tone === 'leaf'} dot>
                {fresh.short}
              </Badge>
            ) : (
              <Badge tone="clay" outline>
                Inactive
              </Badge>
            )}
          </div>
          <h2 id={headingId} dir="auto">
            {entry.name}
          </h2>
          <p className={styles.detailMeta} dir="auto">
            {payamName(entry.payam_id)} Payam · Juba County · Central Equatoria
            {entry.contact_name ? ` · Contact: ${entry.contact_name}` : ''}
          </p>
        </div>
      </div>

      {removed ? (
        <div className={styles.detailSection}>
          <Notice kind="success" title="Removed">
            The entry is now inactive. It stays on the record with the reason you gave; nothing is
            deleted.
          </Notice>
        </div>
      ) : null}

      {!entry.active && entry.removal_note ? (
        <div className={styles.detailSection}>
          <Notice kind="warn" title="Inactive">
            <span dir="auto">{entry.removal_note}</span>
          </Notice>
        </div>
      ) : null}

      {entry.active && fresh.tone === 'sorghum' ? (
        <div className={styles.detailSection}>
          <Notice kind="warn" title="Details may be out of date">
            {fresh.long}
          </Notice>
        </div>
      ) : null}

      <div className={`${styles.detailActions} no-print`}>
        {editor ? (
          <>
            <ButtonLink href={`/directories/${entry.id}/edit`} variant="secondary">
              <IconEdit size={18} />
              Edit entry
            </ButtonLink>
            {entry.active ? (
              <Button variant="danger" onClick={() => setConfirming(true)}>
                <IconRemove size={18} />
                Remove
              </Button>
            ) : null}
          </>
        ) : null}
        <Button variant="ghost" onClick={() => window.print()}>
          <IconPrint size={18} />
          Print
        </Button>
      </div>

      <div className={styles.facts}>
        <div className={styles.fact}>
          <span className="label">Phone</span>
          <span className={`${styles.factValue} num`}>
            <a href={`tel:${entry.phone}`}>{formatPhone(entry.phone)}</a>
          </span>
          {entry.alt_phone ? (
            <span className="small muted num">
              also <a href={`tel:${entry.alt_phone}`}>{formatPhone(entry.alt_phone)}</a>
            </span>
          ) : null}
        </div>
        <div className={styles.fact}>
          <span className="label">Last checked</span>
          <span className={`${styles.factValue} num`}>{formatDate(entry.last_verified_at)}</span>
          <span className="small muted">by programme admin</span>
        </div>
        <div className={styles.fact}>
          <span className="label">Services</span>
          <span className={styles.factValue}>{entry.services.length || 'None listed'}</span>
          <span className="small muted">
            {entry.services.length === 1 ? 'service listed' : 'services listed'}
          </span>
        </div>
      </div>

      {entry.services.length ? (
        <section className={styles.detailSection} aria-label="Services">
          <div className={styles.detailSectionHead}>
            <h3>Services</h3>
          </div>
          <Chips items={entry.services} dir="auto" />
        </section>
      ) : null}

      {entry.description ? (
        <section className={styles.detailSection} aria-label="About">
          <div className={styles.detailSectionHead}>
            <h3>About</h3>
          </div>
          <p className={styles.prose} dir="auto">
            {entry.description}
          </p>
        </section>
      ) : null}

      <section className={styles.detailSection} aria-label="Contact and location">
        <div className={styles.detailSectionHead}>
          <h3>Contact and location</h3>
        </div>
        <DefinitionList
          items={[
            {
              term: 'Phone',
              value: (
                <span className="num">
                  <IconPhone size={16} style={{ display: 'inline', verticalAlign: '-3px' }} />{' '}
                  <a href={`tel:${entry.phone}`}>{formatPhone(entry.phone)}</a>
                </span>
              ),
            },
            ...(entry.alt_phone
              ? [
                  {
                    term: 'Other phone',
                    value: (
                      <span className="num">
                        <a href={`tel:${entry.alt_phone}`}>{formatPhone(entry.alt_phone)}</a>
                      </span>
                    ),
                  },
                ]
              : []),
            {
              term: 'Email',
              value: entry.email ? (
                <span>
                  <IconMail size={16} style={{ display: 'inline', verticalAlign: '-3px' }} />{' '}
                  <a href={`mailto:${entry.email}`}>{entry.email}</a>
                </span>
              ) : (
                <span className="muted">Not given</span>
              ),
            },
            {
              term: 'Address',
              value: entry.physical_address ? (
                <span dir="auto">
                  <IconPin size={16} style={{ display: 'inline', verticalAlign: '-3px' }} />{' '}
                  {entry.physical_address}
                </span>
              ) : (
                <span className="muted">Not given</span>
              ),
            },
            {
              term: 'Payam',
              value: `${payamName(entry.payam_id)} (${entry.payam_id})`,
            },
            {
              term: 'GPS',
              value:
                entry.location && mapHref ? (
                  <span className="num">
                    {entry.location.latitude.toFixed(4)}, {entry.location.longitude.toFixed(4)}{' '}
                    <a href={mapHref} target="_blank" rel="noreferrer" className="no-print">
                      Open map{' '}
                      <IconExternal
                        size={14}
                        style={{ display: 'inline', verticalAlign: '-2px' }}
                      />
                    </a>
                  </span>
                ) : (
                  <span className="muted">No point recorded</span>
                ),
            },
          ]}
        />
      </section>

      <section className={styles.detailSection} aria-label="Record">
        <div className={styles.detailSectionHead}>
          <h3>Record</h3>
          <span className="small muted">every change is audited; nothing here is editable</span>
        </div>
        <DefinitionList
          items={[
            { term: 'Entry id', value: <span className="num small">{entry.id}</span> },
            { term: 'Created', value: formatDate(entry.created_at) },
            { term: 'Updated', value: formatDate(entry.updated_at) },
            { term: 'Status', value: entry.active ? 'Active' : 'Inactive' },
          ]}
        />
      </section>

      <Dialog
        open={confirming}
        onClose={() => setConfirming(false)}
        title={`Remove ${entry.name}?`}
        footer={
          <>
            <Button variant="ghost" onClick={() => setConfirming(false)}>
              Keep entry
            </Button>
            <Button variant="danger" onClick={confirmRemove}>
              <IconRemove size={18} />
              Remove entry
            </Button>
          </>
        }
      >
        <p>
          The entry becomes inactive and disappears from officers’ lists. It is not deleted: the
          record and your reason stay in the audit trail, and an administrator can reactivate it.
        </p>
        <Field
          label="Reason"
          error={reasonError}
          hint="Shown on the record. Example: shop closed, owner moved."
        >
          {(ids) => (
            <Textarea
              {...ids}
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              rows={3}
              dir="auto"
            />
          )}
        </Field>
      </Dialog>
    </Card>
  );
}
