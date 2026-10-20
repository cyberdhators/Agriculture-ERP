'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';

import { BUYER_HOME_PATH, HOME_PATH, LOGIN_PATH } from '@/lib/auth/paths';
import { BuyerApiError, getProfile, listNotifications, type BuyerProfile } from '@/lib/buyer/api';
import { VERIFICATION_LABELS, VERIFICATION_STAMPS } from '@/lib/buyer/labels';
import { setCartOwner, useCart } from '@/lib/buyer/cart';
import { useUnreadMessages } from '@/lib/messages/client';
import { supabaseBrowser } from '@/lib/supabase/browser';

import { Wordmark } from '../brand/Wordmark';
import shell from '../portal/shell.module.css';
import { Stamp } from '../ui';
import { LoadingState } from '../ui/data';
import { ToastProvider } from '../ui/feedback';
import {
  IconChat,
  IconDashboard,
  IconEdit,
  IconInfo,
  IconMail,
  IconMenu,
  IconReports,
  IconSearch,
  IconSignOut,
  IconStaff,
} from '../ui/icons';
import styles from './buyer.module.css';

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
}

const BuyerContext = createContext<BuyerContextValue | null>(null);

export function useBuyer(): BuyerContextValue {
  const value = useContext(BuyerContext);
  if (!value) throw new Error('useBuyer must be used inside BuyerShell');
  return value;
}

const NAV: ReadonlyArray<{
  href: string;
  label: string;
  icon: (p: { size?: number }) => ReactNode;
}> = [
  { href: BUYER_HOME_PATH, label: 'Dashboard', icon: IconDashboard },
  { href: '/buyer/marketplace', label: 'Marketplace', icon: IconSearch },
  // B14: a buyer deals with the farmer directly, so the cart and the requests
  // are the whole of buying; orders and deliveries are no longer offered.
  { href: '/buyer/cart', label: 'Cart', icon: IconReports },
  { href: '/buyer/purchase-requests', label: 'My requests', icon: IconEdit },
  // LISTINGS LANE (2026-10-19): public buying requests ("I need X"), not the
  // requests above, which go to one listing.
  { href: '/buyer/buying-requests', label: 'Buying requests', icon: IconReports },
  // 2026-10-20: in-app messaging about posts.
  { href: '/buyer/messages', label: 'Messages', icon: IconChat },
  // 2026-10-22: independent advice -- find a provider and ask, or offer it.
  // My Advisory Work is reached from Offer advice once a profile exists.
  { href: '/buyer/advice', label: 'Find advice', icon: IconSearch },
  { href: '/buyer/advice/requests', label: 'My advice requests', icon: IconChat },
  { href: '/buyer/advice/offer', label: 'Offer advice', icon: IconStaff },
  { href: '/buyer/notifications', label: 'Notifications', icon: IconMail },
  { href: '/buyer/profile', label: 'Profile', icon: IconStaff },
  // 2026-10-23: public profiles v2 -- draft, preview, publish, photo.
  { href: '/buyer/public-profile', label: 'My public profile', icon: IconStaff },
  // 2026-10-19: one account buys and sells (CORWADO).
  { href: '/buyer/sell', label: 'Sell produce', icon: IconDashboard },
  { href: '/buyer/about', label: 'About you', icon: IconStaff },
  // 2026-10-21: "Contact CORWADO" -- FAQs and a message form (public page).
  { href: '/help', label: 'Help', icon: IconInfo },
];

export function BuyerShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
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
      setFailure(error instanceof Error ? error.message : 'Your account could not be loaded.');
    }
  }, [pathname]);

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
    () => (profile ? { profile, refresh, unread, refreshUnread } : null),
    [profile, refresh, unread, refreshUnread],
  );

  const active = NAV.map((n) => n.href)
    .filter((href) => pathname === href || pathname.startsWith(`${href}/`))
    .sort((a, b) => b.length - a.length)[0];

  return (
    <ToastProvider>
      <div className={shell.shell}>
        <a href="#main" className="skip-link">
          Skip to content
        </a>

        <nav
          id="buyer-rail"
          aria-label="Buyer"
          className={[shell.rail, drawerOpen ? shell.railOpen : ''].filter(Boolean).join(' ')}
        >
          <div className={shell.railHead}>
            <span className={shell.railWordmark}>
              <Wordmark size={20} onBand href={BUYER_HOME_PATH} />
            </span>
          </div>
          <div className={shell.railNav}>
            <h2 className={shell.sectionHeading}>Procurement</h2>
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
                      <span className={shell.itemLabel}>{item.label}</span>
                      {item.href === '/buyer/cart' && cart.length > 0 ? (
                        <span className={shell.badge} aria-label={`${cart.length} in the cart`}>
                          {cart.length}
                        </span>
                      ) : null}
                      {item.href === '/buyer/messages' && unreadMessages > 0 ? (
                        <span className={shell.badge} aria-label={`${unreadMessages} unread`}>
                          {unreadMessages}
                        </span>
                      ) : null}
                      {item.href === '/buyer/notifications' && unread !== null && unread > 0 ? (
                        <span className={shell.badge} aria-label={`${unread} unread`}>
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
              {profile?.organization.name ?? 'Buyer'}
            </span>
            <button type="button" className={shell.signOut} onClick={() => void signOut()}>
              <IconSignOut size={16} />
              <span>Sign out</span>
            </button>
          </div>
        </nav>

        {drawerOpen ? (
          <button
            type="button"
            className={shell.scrimOpen}
            aria-label="Close the menu"
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
              aria-label="Open the menu"
            >
              <IconMenu size={20} />
            </button>
            <div className={shell.topbarText}>
              {/* 2026-10-22 (the owner): on a phone a personal account shows its
                  first name only, and any name is cut short with an ellipsis,
                  so it never runs under the icons. */}
              <span className={shell.pageTitle} dir="auto">
                <span className={styles.nameFull}>
                  {profile?.organization.name ?? 'Buyer account'}
                </span>
                <span className={styles.nameShort}>
                  {profile
                    ? profile.organization.account_type === 'individual'
                      ? profile.person.given_name
                      : profile.organization.name
                    : 'Buyer account'}
                </span>
              </span>
              {/* On a phone the standing moves under the name: beside the
                  icons there is no room for it and the name both. */}
              {profile ? (
                <span className={styles.stampUnder}>
                  <Stamp kind={VERIFICATION_STAMPS[profile.verification.status]}>
                    {VERIFICATION_LABELS[profile.verification.status]}
                  </Stamp>
                </span>
              ) : null}
            </div>
            <div className={`${shell.topbarSide} ${styles.topActions}`}>
              <Link href="/buyer/messages" aria-label="Messages" className={styles.topIcon}>
                <IconChat size={18} />
                {unreadMessages > 0 ? (
                  <span className={styles.unreadDot}>{unreadMessages}</span>
                ) : null}
              </Link>
              <Link
                href="/buyer/notifications"
                aria-label="Notifications"
                className={styles.topIcon}
              >
                <IconMail size={18} />
                {unread !== null && unread > 0 ? (
                  <span className={styles.unreadDot}>{unread}</span>
                ) : null}
              </Link>
              {profile ? (
                <span className={styles.stampSide}>
                  <Stamp kind={VERIFICATION_STAMPS[profile.verification.status]}>
                    {VERIFICATION_LABELS[profile.verification.status]}
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
                <span className={styles.signOutLabel}>Sign out</span>
              </button>
            </div>
          </header>

          <main id="main" className={shell.content} tabIndex={-1}>
            {failure ? (
              <p role="alert">{failure}</p>
            ) : value ? (
              <BuyerContext.Provider value={value}>{children}</BuyerContext.Provider>
            ) : (
              <LoadingState label="Loading your account" rows={4} />
            )}
          </main>

          <footer className={`${shell.footer} no-print`}>
            <Wordmark size={16} />
            <span>© {new Date().getFullYear()} AgriOne South Sudan · CORWADO</span>
          </footer>
        </div>
      </div>
    </ToastProvider>
  );
}
