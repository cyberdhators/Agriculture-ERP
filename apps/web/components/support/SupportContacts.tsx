'use client';

import Link from 'next/link';
import type { ReactNode } from 'react';

import type { PublicSettings } from '@agri-erp/shared';

import { t, type Language } from '@/lib/i18n';
import { usePublicSettings } from '@/lib/settings/client';

import css from '@/components/account/settings.module.css';

/**
 * SUPPORT CONTACTS AND HELP LINKS (2026-10-25, settings phase 1), as CORWADO
 * publishes them in Settings -> Identity and help. Read from the public
 * settings (GET /api/settings/public).
 *
 * Nothing is invented: a contact CORWADO has not published is not shown, and
 * when none is published the help page shows its form only and the footer
 * only its Help link -- exactly as before settings existed.
 */

const telHref = (n: string) => `tel:${n.replace(/[^\d+]/g, '')}`;
const whatsappHref = (n: string) => `https://wa.me/${n.replace(/\D/g, '')}`;

function hasContact(s: PublicSettings): boolean {
  const c = s.support;
  return Boolean(c.phone || c.email || c.whatsapp || c.office_hours);
}

/**
 * The help page's contact card, the About text and the help links.
 *
 * 2026-10-31 (the owner: "more beautiful and more appealing"): in the
 * settings kit -- a small group title over a white card; each contact a row,
 * its label on the left and the number or address on the right.
 */
export function SupportContactsCard({ language }: { language: Language }) {
  const settings = usePublicSettings();
  if (!settings) return null;
  const { support, about } = settings;
  const contacts: { label: string; value: ReactNode }[] = [];
  if (support.phone)
    contacts.push({
      label: t('help.contactPhone', language),
      value: (
        <a href={telHref(support.phone)} dir="ltr">
          {support.phone}
        </a>
      ),
    });
  if (support.whatsapp)
    contacts.push({
      label: t('help.contactWhatsapp', language),
      value: (
        <a href={whatsappHref(support.whatsapp)} rel="noopener noreferrer" dir="ltr">
          {support.whatsapp}
        </a>
      ),
    });
  if (support.email)
    contacts.push({
      label: t('help.contactEmail', language),
      value: (
        <a href={`mailto:${support.email}`} dir="ltr">
          {support.email}
        </a>
      ),
    });
  if (support.office_hours)
    contacts.push({
      label: t('help.contactHours', language),
      value: <span dir="auto">{support.office_hours}</span>,
    });
  return (
    <>
      {about ? (
        <section className={css.group} aria-labelledby="help-about">
          <h2 id="help-about" className={css.groupTitle}>
            {t('help.aboutTitle', language)}
          </h2>
          <div className={css.formCard}>
            <p className="small" dir="auto" style={{ whiteSpace: 'pre-line' }}>
              {about}
            </p>
          </div>
        </section>
      ) : null}
      {hasContact(settings) ? (
        <section className={css.group} aria-labelledby="help-contact">
          <h2 id="help-contact" className={css.groupTitle}>
            {t('help.contactTitle', language)}
          </h2>
          <dl className={css.list}>
            {contacts.map(({ label, value }) => (
              <div key={label} className={css.row}>
                <dt className={`${css.rowText} ${css.rowLabel}`}>{label}</dt>
                <dd className={css.rowValue}>{value}</dd>
              </div>
            ))}
          </dl>
        </section>
      ) : null}
      {support.help_links.length > 0 ? (
        <section className={css.group} aria-labelledby="help-links">
          <h2 id="help-links" className={css.groupTitle}>
            {t('help.linksTitle', language)}
          </h2>
          <ul className={css.list}>
            {support.help_links.map((link) => (
              <li key={link.url} className={css.row}>
                <a href={link.url} rel="noopener noreferrer" target="_blank" dir="auto">
                  {link.label}
                </a>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </>
  );
}

/** One line for a site footer: Help, then whichever contacts are published. */
export function SupportContactsLine({ language }: { language: Language }) {
  const settings = usePublicSettings();
  const support = settings?.support;
  return (
    <span className="small" style={{ display: 'inline-flex', flexWrap: 'wrap', gap: 12 }}>
      <Link href="/help">{t('footer.help', language)}</Link>
      {support?.phone ? (
        <a href={telHref(support.phone)} dir="ltr">
          {support.phone}
        </a>
      ) : null}
      {support?.whatsapp ? (
        <a href={whatsappHref(support.whatsapp)} rel="noopener noreferrer" dir="ltr">
          {t('help.contactWhatsapp', language)}
        </a>
      ) : null}
      {support?.email ? (
        <a href={`mailto:${support.email}`} dir="ltr">
          {support.email}
        </a>
      ) : null}
    </span>
  );
}
