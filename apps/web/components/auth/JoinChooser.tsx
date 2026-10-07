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
          <h1 className={styles.title}>Sign in or register</h1>
          <p className={styles.hint}>
            Choose the account that fits you. Farmers sell their produce; buyers buy it. The two
            accounts are separate.
          </p>
        </div>

        <div className={styles.joinGrid}>
          <Card padded className={styles.joinCard}>
            <h2>I am a farmer</h2>
            <p className="small">I want to sell my produce to buyers.</p>
            <ul className={styles.joinList}>
              <li>Register with your phone number and a password.</li>
              <li>CORWADO verifies you before your produce goes live.</li>
              <li>Buyers send you requests; you accept or decline and agree the deal directly.</li>
            </ul>
            <div className={styles.joinActions}>
              <ButtonLink href="/farmer/register">Register as a farmer</ButtonLink>
              <ButtonLink href="/farmer/login" variant="secondary">
                Farmer sign in
              </ButtonLink>
            </div>
          </Card>

          <Card padded className={styles.joinCard}>
            <h2>I am a buyer</h2>
            <p className="small">I want to buy produce from farmers.</p>
            <ul className={styles.joinList}>
              <li>Register with your email address and a password.</li>
              <li>Individuals can buy straight away; businesses are reviewed first.</li>
              <li>Sign in to add products to your cart and send requests to farmers.</li>
            </ul>
            <div className={styles.joinActions}>
              <ButtonLink href="/buyer/register">Register as a buyer</ButtonLink>
              <ButtonLink href={login} variant="secondary">
                Buyer sign in
              </ButtonLink>
            </div>
          </Card>
        </div>

        <p className={styles.hint}>
          CORWADO staff and extension officers: <a href="/login">sign in here</a>. Staff accounts
          are issued by an administrator.
        </p>
      </div>
    </main>
  );
}
