import { Wordmark } from '../brand/Wordmark';
import { ButtonLink, Card } from '../ui';
import styles from './auth.module.css';

/**
 * SIGN IN OR REGISTER -- FARMER OR BUYER (B14, the owner, 2026-10-07: "make sure
 * it is clear the difference between farmers account creation and buyer
 * account creation").
 *
 * The two accounts are different things, made in different places:
 *
 *   - a FARMER sells. Registers with a phone number and a password, is
 *     verified by CORWADO, then lists produce. Signs in at /farmer/login.
 *   - a BUYER buys. Registers with an email and a password; an individual can
 *     buy at once, a business is reviewed first. Signs in at /login, then adds
 *     products to a cart and sends requests to farmers.
 *
 * Staff do not register here: an administrator issues their accounts.
 */
export function JoinChooser({ next }: { next: string }) {
  const buyerNext = next.startsWith('/buyer') ? next : '/buyer/marketplace';
  const login = `/login?next=${encodeURIComponent(buyerNext)}`;
  return (
    <main className={styles.wrap}>
      <div className={styles.join}>
        <header className={styles.joinHead}>
          <Wordmark size={34} tagline />
          <h1 className={styles.joinTitle}>Sign in or create an account</h1>
          <p className={styles.joinLead}>
            One AgriOne account lets you buy, sell, offer services and get advice. Choose how you
            sign in: with your phone number or with an email address.
          </p>
        </header>

        <div className={styles.joinGrid}>
          <Card padded className={styles.joinCard}>
            <span className={styles.joinIcon} aria-hidden>
              <svg
                viewBox="0 0 24 24"
                width="24"
                height="24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <rect x="6" y="2.5" width="12" height="19" rx="2.5" />
                <path d="M10.5 18.5h3" />
              </svg>
            </span>
            <h2>With your phone number</h2>
            <p className={styles.joinFor}>For anyone with a South Sudan mobile number.</p>
            <ul className={styles.joinList}>
              <li>Create your account with your phone number and a password.</li>
              <li>We send a code by SMS to confirm the number.</li>
              <li>Sell, buy, offer services and ask for advice from the same account.</li>
            </ul>
            <div className={styles.joinActions}>
              <ButtonLink href="/farmer/register">Create account</ButtonLink>
              <ButtonLink href="/farmer/login" variant="secondary">
                Sign in
              </ButtonLink>
            </div>
          </Card>

          <Card padded className={styles.joinCard}>
            <span className={styles.joinIcon} aria-hidden>
              <svg
                viewBox="0 0 24 24"
                width="24"
                height="24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <rect x="2.5" y="5" width="19" height="14" rx="2.5" />
                <path d="m3.5 6.5 8.5 6.5 8.5-6.5" />
              </svg>
            </span>
            <h2>With an email address</h2>
            <p className={styles.joinFor}>
              For businesses and organisations, or without a +211 number.
            </p>
            <ul className={styles.joinList}>
              <li>Create your account with your email address and a password.</li>
              <li>Individuals start straight away; businesses are reviewed first.</li>
              <li>Buy now, and start selling from the same account whenever you like.</li>
            </ul>
            <div className={styles.joinActions}>
              <ButtonLink href="/buyer/register">Create account</ButtonLink>
              <ButtonLink href={login} variant="secondary">
                Sign in
              </ButtonLink>
            </div>
          </Card>
        </div>

        {/*
         * 2026-10-19 (the owner): the installed app shows no address bar, so
         * staff cannot type /admin/login -- their way in is a button here,
         * the page the app opens on when nobody is signed in. 2026-10-31: a
         * slim row under the two member cards, since few people need it.
         */}
        <section className={styles.joinStaff} aria-labelledby="join-staff">
          <div>
            <h2 id="join-staff">CORWADO staff and extension officers</h2>
            <p className={styles.joinFor}>
              For accounts issued by an administrator. Staff sign in with their email address;
              extension officers with their phone number.
            </p>
          </div>
          <ButtonLink href="/admin/login" variant="secondary">
            Staff sign in
          </ButtonLink>
        </section>

        <p className={styles.joinBack}>
          <a href="/market">Back to the marketplace</a>
          <span aria-hidden> · </span>
          <a href="/help">Help</a>
        </p>
      </div>
    </main>
  );
}
