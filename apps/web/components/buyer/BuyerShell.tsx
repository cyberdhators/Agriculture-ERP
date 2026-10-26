'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';

import { BUYER_HOME_PATH, HOME_PATH, LOGIN_PATH } from '@/lib/auth/paths';
import {
  BuyerApiError,
  getProfile,
  listNotifications,
  updateProfile,
  type BuyerProfile,
} from '@/lib/buyer/api';
import { VERIFICATION_STAMPS, showsStandingStamp, verificationLabel } from '@/lib/buyer/labels';
import { DEFAULT_LANGUAGE, isRtl, t, type Language, type TKey } from '@/lib/i18n';
import { useDocumentLanguage, useLanguageChoice } from '@/lib/i18n/client';
import { setCartOwner, useCart } from '@/lib/buyer/cart';
import { useUnreadMessages } from '@/lib/messages/client';
import { supabaseBrowser } from '@/lib/supabase/browser';

import { Wordmark } from '../brand/Wordmark';
import shell from '../portal/shell.module.css';
import { Stamp } from '../ui';
import { LoadingState } from '../ui/data';
import { ToastProvider } from '../ui/feedback';
import {
  IconBell,
  IconBuilding,
  IconCart,
  IconChat,
  IconClipboard,
  IconDashboard,
  IconEdit,
  IconEye,
  IconHelp,
  IconInfo,
  IconLightbulb,
  IconMenu,
  IconReports,
  IconSearch,
  IconSend,
  IconSignOut,
  IconStore,
  IconTag,
  IconTools,
  IconUser,
} from '../ui/icons';
import { LanguageButtons } from '../farmer/LanguageSwitch';
import styles from './buyer.module.css';
import { ActingAsBar } from '../teams/ActingAsBar';

/**
 * THE BUYER SHELL (B13). The staff portal's rail and header, a buyer's
 * destinations, and the one thing every buyer page needs to know: who this
 * is, which organisation, and what its standing allows.
 *
 * THE NAVIGATION OFFERS ONLY WHAT EXISTS. The brief suggested "Products",
 * "Farmers / Suppliers", "Messages", "Reports" and "Settings". They are not
 * here, deliberately: products ARE the marketplace; a supplier directory would
 * be a list of farmers, which is exactly what a buyer must not be given
 * (C-14B.8); there is no messaging system; the dashboard is the report; and
 * the profile is the settings. A menu item with nothing behind it is a promise
 * the system does not keep.
 *
 * Standing is displayed here and enforced by every route. If a staff member
 * reaches this shell, /api/buyer/profile answers 403 and they are sent to the
 * staff portal; if nobody is signed in, to the sign-in page.
 */

interface BuyerContextValue {
  profile: BuyerProfile;
  refresh: () => Promise<void>;
  unread: number | null;
  refreshUnread: () => void;
  /**
   * 2026-10-29: the language the buyer screens speak -- the account's
   * preferred_language, then this browser's choice; the switch saves both.
   */
  language: Language;
  setLanguage: (lang: Language) => void;
}

const BuyerContext = createContext<BuyerContextValue | null>(null);

export function useBuyer(): BuyerContextValue {
  const value = useContext(BuyerContext);
  if (!value) throw new Error('useBuyer must be used inside BuyerShell');
  return value;
}

const NAV: ReadonlyArray<{
  href: string;
  label: TKey;
  icon: (p: { size?: number }) => ReactNode;
}> = [
  { href: BUYER_HOME_PATH, label: 'buyer.nav.dashboard', icon: IconDashboard },
  { href: '/buyer/marketplace', label: 'buyer.nav.marketplace', icon: IconStore },
  // B14: a buyer deals with the farmer directly, so the cart and the requests
  // are the whole of buying; orders and deliveries are no longer offered.
  { href: '/buyer/cart', label: 'buyer.nav.cart', icon: IconCart },
  { href: '/buyer/purchase-requests', label: 'buyer.nav.myRequests', icon: IconSend },
  // LISTINGS LANE (2026-10-19): public buying requests ("I need X"), not the
  // requests above, which go to one listing.
  { href: '/buyer/buying-requests', label: 'buyer.nav.buyingRequests', icon: IconClipboard },
  // 2026-10-26: any account offers services -- an institute, college,
  // research body, advisory organisation or adviser as well as a farmer.
  { href: '/buyer/services', label: 'buyer.nav.myServices', icon: IconTools },
  // 2026-10-20: in-app messaging about posts.
  { href: '/buyer/messages', label: 'buyer.nav.messages', icon: IconChat },
  // 2026-10-22: independent advice -- find a provider and ask, or offer it.
  // 2026-10-24 (acceptance QA): My Advisory Work is in the menu too, as on the
  // farmer side; without a profile its page says to offer advice first.
  { href: '/buyer/advice', label: 'buyer.nav.findAdvice', icon: IconSearch },
  { href: '/buyer/advice/requests', label: 'buyer.nav.myAdviceRequests', icon: IconHelp },
  { href: '/buyer/advice/offer', label: 'buyer.nav.offerAdvice', icon: IconLightbulb },
  { href: '/buyer/advice/work', label: 'buyer.nav.advisoryWork', icon: IconReports },
  { href: '/buyer/notifications', label: 'buyer.nav.notifications', icon: IconBell },
  { href: '/buyer/profile', label: 'buyer.nav.profile', icon: IconUser },
  // 2026-10-23: public profiles v2 -- draft, preview, publish, photo.
  { href: '/buyer/public-profile', label: 'buyer.nav.publicProfile', icon: IconEye },
  // 2026-10-19: one account buys and sells (CORWADO).
  { href: '/buyer/sell', label: 'buyer.nav.sell', icon: IconTag },
  { href: '/buyer/about', label: 'buyer.nav.about', icon: IconEdit },
  // 2026-10-27: organisational profiles and team access.
  { href: '/buyer/organisations', label: 'buyer.nav.organisations', icon: IconBuilding },
  // 2026-10-21: "Contact CORWADO" -- FAQs and a message form (public page).
  { href: '/help', label: 'buyer.nav.help', icon: IconInfo },
];

export function BuyerShell({
  children,
  initialLanguage = DEFAULT_LANGUAGE,
}: {
  children: ReactNode;
  /** From the language cookie, read on the server, so the first paint is in it. */
  initialLanguage?: Language;
}) {
  const pathname = usePathname();
  const [language, chooseLanguage] = useLanguageChoice(initialLanguage);
  useDocumentLanguage(language);
  const rtl = isRtl(language);
  const adopted = useRef(false);
  const [profile, setProfile] = useState<BuyerProfile | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const [unread, setUnread] = useState<number | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const cart = useCart();
  const unreadMessages = useUnreadMessages(profile !== null);

  const refresh = useCallback(async () => {
    try {
      const loaded = await getProfile();
      // The cart is this buyer's, not this browser's (B14).
      setCartOwner(loaded.person.id);
      // The account's own choice wins once, on arrival; the switch keeps the
      // two in step from then on.
      if (!adopted.current) {
        adopted.current = true;
        if (loaded.person.preferred_language) chooseLanguage(loaded.person.preferred_language);
      }
      setProfile(loaded);
      setFailure(null);
    } catch (error) {
      if (error instanceof BuyerApiError && error.status === 401) {
        window.location.replace(`${LOGIN_PATH}?next=${encodeURIComponent(pathname)}`);
        return;
      }
      if (error instanceof BuyerApiError && error.status === 403) {
        // Signed in, but not as a buyer: this is not their side of the system.
        window.location.replace(HOME_PATH);
        return;
      }
      setFailure(error instanceof Error ? error.message : t('buyer.shell.loadFailed', language));
    }
  }, [pathname, chooseLanguage, language]);

  const setLanguage = useCallback(
    (lang: Language) => {
      chooseLanguage(lang);
      // Saved on the account, so codes and notices follow it too. Best effort:
      // the screen has already changed.
      void updateProfile({ preferred_language: lang }).catch(() => undefined);
    },
    [chooseLanguage],
  );

  const refreshUnread = useCallback(() => {
    listNotifications(true)
      .then((page) => setUnread(page.unread ?? null))
      .catch(() => setUnread(null));
  }, []);

  // Once per arrival, not per navigation: the profile changes when the buyer
  // saves it or an administrator decides, and the screens refresh it then.
  const [loaded, setLoaded] = useState(false);
  useEffect(() => {
    if (loaded) return;
    setLoaded(true);
    void refresh();
  }, [loaded, refresh]);

  useEffect(() => {
    refreshUnread();
    setDrawerOpen(false);
  }, [pathname, refreshUnread]);

  const signOut = useCallback(async () => {
    setCartOwner(null);
    try {
      // 'local': end the session on this device even when the network is down;
      // the server-side token simply expires.
      await supabaseBrowser().auth.signOut({ scope: 'local' });
    } finally {
      // Always leave the buyer pages, even if the call failed.
      window.location.assign(LOGIN_PATH);
    }
  }, []);

  const value = useMemo(
    () => (profile ? { profile, refresh, unread, refreshUnread, language, setLanguage } : null),
    [profile, refresh, unread, refreshUnread, language, setLanguage],
  );

  const active = NAV.map((n) => n.href)
    .filter((href) => pathname === href || pathname.startsWith(`${href}/`))
    .sort((a, b) => b.length - a.length)[0];

  return (
    <ToastProvider>
      <div className={shell.shell} dir={rtl ? 'rtl' : 'ltr'}>
        <a href="#main" className="skip-link">
          {t('shell.skip', language)}
        </a>

        <nav
          id="buyer-rail"
          aria-label={t('buyer.shell.rail', language)}
          className={[shell.rail, drawerOpen ? shell.railOpen : ''].filter(Boolean).join(' ')}
        >
          <div className={shell.railHead}>
            <span className={shell.railWordmark}>
              <Wordmark size={20} onBand href={BUYER_HOME_PATH} />
            </span>
          </div>
          <div className={shell.railNav}>
            <h2 className={shell.sectionHeading}>{t('buyer.shell.procurement', language)}</h2>
            <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
              {NAV.map((item) => {
                const Icon = item.icon;
                const isActive = item.href === active;
                return (
                  <li key={item.href}>
                    <Link
                      href={item.href}
                      className={`${shell.item} ${isActive ? shell.itemActive : ''}`}
                      aria-current={isActive ? 'page' : undefined}
                    >
                      <span className={shell.itemIcon}>
                        <Icon size={19} />
                      </span>
                      <span className={shell.itemLabel}>{t(item.label, language)}</span>
                      {item.href === '/buyer/cart' && cart.length > 0 ? (
                        <span
                          className={shell.badge}
                          aria-label={t('buyer.shell.inCart', language).replace(
                            '{n}',
                            String(cart.length),
                          )}
                        >
                          {cart.length}
                        </span>
                      ) : null}
                      {item.href === '/buyer/messages' && unreadMessages > 0 ? (
                        <span
                          className={shell.badge}
                          aria-label={t('buyer.shell.unread', language).replace(
                            '{n}',
                            String(unreadMessages),
                          )}
                        >
                          {unreadMessages}
                        </span>
                      ) : null}
                      {item.href === '/buyer/notifications' && unread !== null && unread > 0 ? (
                        <span
                          className={shell.badge}
                          aria-label={t('buyer.shell.unread', language).replace(
                            '{n}',
                            String(unread),
                          )}
                        >
                          {unread}
                        </span>
                      ) : null}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
          <div className={shell.railFoot}>
            <span className={shell.whoName} dir="auto">
              {profile ? `${profile.person.given_name} ${profile.person.family_name}` : '…'}
            </span>
            <span className={shell.whoRole} dir="auto">
              {profile?.organization.name ?? t('buyer.shell.buyer', language)}
            </span>
            {/* 2026-10-29: English / العربية, saved on the account. */}
            <LanguageButtons value={language} onChange={setLanguage} />
            <button type="button" className={shell.signOut} onClick={() => void signOut()}>
              <IconSignOut size={16} />
              <span>{t('account.signOut', language)}</span>
            </button>
          </div>
        </nav>

        {drawerOpen ? (
          <button
            type="button"
            className={shell.scrimOpen}
            aria-label={t('buyer.shell.closeMenu', language)}
            onClick={() => setDrawerOpen(false)}
          />
        ) : (
          <span className={shell.scrim} />
        )}

        <div className={shell.main}>
          <header className={shell.topbar}>
            <button
              type="button"
              className={shell.menuToggle}
              onClick={() => setDrawerOpen(true)}
              aria-controls="buyer-rail"
              aria-label={t('buyer.shell.openMenu', language)}
            >
              <IconMenu size={20} />
            </button>
            <div className={shell.topbarText}>
              {/* 2026-10-22 (the owner): on a phone a personal account shows its
                  first name only, and any name is cut short with an ellipsis,
                  so it never runs under the icons. */}
              <span className={shell.pageTitle} dir="auto">
                <span className={styles.nameFull}>
                  {profile?.organization.name ?? t('buyer.shell.account', language)}
                </span>
                <span className={styles.nameShort}>
                  {profile
                    ? profile.organization.account_type === 'individual'
                      ? profile.person.given_name
                      : profile.organization.name
                    : t('buyer.shell.account', language)}
                </span>
              </span>
              {/* On a phone the standing moves under the name: beside the
                  icons there is no room for it and the name both. */}
              {profile &&
              showsStandingStamp(profile.organization.account_type, profile.verification.status) ? (
                <span className={styles.stampUnder}>
                  <Stamp kind={VERIFICATION_STAMPS[profile.verification.status]}>
                    {verificationLabel(profile.verification.status, language)}
                  </Stamp>
                </span>
              ) : null}
            </div>
            <div className={`${shell.topbarSide} ${styles.topActions}`}>
              <Link
                href="/buyer/messages"
                aria-label={t('buyer.nav.messages', language)}
                className={styles.topIcon}
              >
                <IconChat size={18} />
                {unreadMessages > 0 ? (
                  <span className={styles.unreadDot}>{unreadMessages}</span>
                ) : null}
              </Link>
              <Link
                href="/buyer/notifications"
                aria-label={t('buyer.nav.notifications', language)}
                className={styles.topIcon}
              >
                <IconBell size={18} />
                {unread !== null && unread > 0 ? (
                  <span className={styles.unreadDot}>{unread}</span>
                ) : null}
              </Link>
              {profile &&
              showsStandingStamp(profile.organization.account_type, profile.verification.status) ? (
                <span className={styles.stampSide}>
                  <Stamp kind={VERIFICATION_STAMPS[profile.verification.status]}>
                    {verificationLabel(profile.verification.status, language)}
                  </Stamp>
                </span>
              ) : null}
              {/* Always visible (2026-10-08): the rail's sign-out sits at the
                  bottom of a menu that is folded away on a phone. */}
              <button
                type="button"
                className={`${shell.signOut} ${styles.topSignOut}`}
                style={{ marginBlockStart: 0, color: 'inherit', borderColor: 'currentColor' }}
                onClick={() => void signOut()}
              >
                <IconSignOut size={16} />
                <span className={styles.signOutLabel}>{t('account.signOut', language)}</span>
              </button>
            </div>
          </header>

          <main id="main" className={shell.content} tabIndex={-1}>
            {failure ? (
              <p role="alert">{failure}</p>
            ) : value ? (
              <BuyerContext.Provider value={value}>
                {/* 2026-10-27: who the buyer acts for, when they belong to an organisation. */}
                <ActingAsBar language={language} />
                {children}
              </BuyerContext.Provider>
            ) : (
              <LoadingState label={t('buyer.shell.loading', language)} rows={4} />
            )}
          </main>

          <footer className={`${shell.footer} no-print`}>
            <Wordmark size={16} />
            <span>
              © {new Date().getFullYear()} {t('buyer.shell.footer', language)}
            </span>
          </footer>
        </div>
      </div>
    </ToastProvider>
  );
}
