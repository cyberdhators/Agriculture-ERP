'use client';

import Link from 'next/link';

import type { PublicSettings } from '@agri-erp/shared';

import { t, type Language } from '@/lib/i18n';
import { usePublicSettings } from '@/lib/settings/client';

import styles from '@/components/farmer/farmer.module.css';

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

/** The help page's contact card, the About text and the help links. */
export function SupportContactsCard({ language }: { language: Language }) {
  const settings = usePublicSettings();
  if (!settings) return null;
  const { support, about } = settings;
  return (
    <>
      {about ? (
        <section className={styles.settingCard}>
          <h2>{t('help.aboutTitle', language)}</h2>
          <p className="small" dir="auto" style={{ whiteSpace: 'pre-line' }}>
            {about}
          </p>
        </section>
      ) : null}
      {hasContact(settings) ? (
        <section className={styles.settingCard}>
          <h2>{t('help.contactTitle', language)}</h2>
          <dl className="small" style={{ display: 'grid', gap: 'var(--s-2, 8px)', margin: 0 }}>
            {support.phone ? (
              <div>
                <dt className="muted">{t('help.contactPhone', language)}</dt>
                <dd style={{ margin: 0 }}>
                  <a href={telHref(support.phone)} dir="ltr">
                    {support.phone}
                  </a>
                </dd>
              </div>
            ) : null}
            {support.whatsapp ? (
              <div>
                <dt className="muted">{t('help.contactWhatsapp', language)}</dt>
                <dd style={{ margin: 0 }}>
                  <a href={whatsappHref(support.whatsapp)} rel="noopener noreferrer" dir="ltr">
                    {support.whatsapp}
                  </a>
                </dd>
              </div>
            ) : null}
            {support.email ? (
              <div>
                <dt className="muted">{t('help.contactEmail', language)}</dt>
                <dd style={{ margin: 0 }}>
                  <a href={`mailto:${support.email}`} dir="ltr">
                    {support.email}
                  </a>
                </dd>
              </div>
            ) : null}
            {support.office_hours ? (
              <div>
                <dt className="muted">{t('help.contactHours', language)}</dt>
                <dd style={{ margin: 0 }} dir="auto">
                  {support.office_hours}
                </dd>
              </div>
            ) : null}
          </dl>
        </section>
      ) : null}
      {support.help_links.length > 0 ? (
        <section className={styles.settingCard}>
          <h2>{t('help.linksTitle', language)}</h2>
          <ul className="small" style={{ margin: 0, paddingInlineStart: 18 }}>
            {support.help_links.map((link) => (
              <li key={link.url}>
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
