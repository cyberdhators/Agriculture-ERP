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
        <div className={styles.brand}>
          <Wordmark size={28} tagline />
        </div>
        <div>
          <h1 className={styles.title}>Sign in or create an account</h1>
          <p className={styles.hint}>
            One AgriOne account lets you buy, sell, offer services and get advice. Choose how you
            sign in: with your phone number or with an email address.
          </p>
        </div>

        <div className={styles.joinGrid}>
          <Card padded className={styles.joinCard}>
            <h2>With your phone number</h2>
            <p className="small">For anyone with a South Sudan mobile number.</p>
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
            <h2>With an email address</h2>
            <p className="small">For businesses and organisations, or without a +211 number.</p>
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

          {/*
           * 2026-10-19 (the owner): the installed app shows no address bar, so
           * staff cannot type /admin/login -- their way in is a button here,
           * the page the app opens on when nobody is signed in.
           */}
          <Card padded className={styles.joinCard}>
            <h2>CORWADO staff and extension officers</h2>
            <p className="small">For accounts issued by an administrator.</p>
            <ul className={styles.joinList}>
              <li>Staff sign in with their email address.</li>
              <li>Extension officers sign in with their phone number.</li>
            </ul>
            <div className={styles.joinActions}>
              <ButtonLink href="/admin/login" variant="secondary">
                Staff sign in
              </ButtonLink>
            </div>
          </Card>
        </div>
      </div>
    </main>
  );
}
