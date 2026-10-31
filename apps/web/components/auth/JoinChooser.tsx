'use client';

import { LanguageButtons } from '@/components/farmer/LanguageSwitch';
import { DEFAULT_LANGUAGE, isRtl, type Language } from '@/lib/i18n';
import { useDocumentLanguage, useLanguageChoice } from '@/lib/i18n/client';

import { Wordmark } from '../brand/Wordmark';
import { ButtonLink, Card } from '../ui';
import styles from './auth.module.css';

/** 2026-10-31 (Arabic pass): the page's words, in both languages. */
const W = {
  en: {
    title: 'Sign in or create an account',
    lead: 'One AgriOne account lets you buy, sell, offer services and get advice. Choose how you sign in: with your phone number or with an email address.',
    phoneTitle: 'With your phone number',
    phoneFor: 'For anyone with a South Sudan mobile number.',
    phoneList: [
      'Create your account with your phone number and a password.',
      'We send a code by SMS to confirm the number.',
      'Sell, buy, offer services and ask for advice from the same account.',
    ],
    emailTitle: 'With an email address',
    emailFor: 'For businesses and organisations, or without a +211 number.',
    emailList: [
      'Create your account with your email address and a password.',
      'Individuals start straight away; businesses are reviewed first.',
      'Buy now, and start selling from the same account whenever you like.',
    ],
    create: 'Create account',
    signIn: 'Sign in',
    staffTitle: 'CORWADO staff and extension officers',
    staffFor:
      'For accounts issued by an administrator. Staff sign in with their email address; extension officers with their phone number.',
    staffSignIn: 'Staff sign in',
    back: 'Back to the marketplace',
    help: 'Help',
  },
  ar: {
    title: 'سجّل الدخول أو أنشئ حساباً',
    lead: 'حساب واحد في أجري ون للشراء والبيع وتقديم الخدمات وطلب النصيحة. اختر طريقة الدخول: برقم هاتفك أو ببريد إلكتروني.',
    phoneTitle: 'برقم هاتفك',
    phoneFor: 'لكل من لديه رقم هاتف محمول في جنوب السودان.',
    phoneList: [
      'أنشئ حسابك برقم هاتفك وكلمة مرور.',
      'نرسل رمزاً برسالة نصية لتأكيد الرقم.',
      'بِع واشترِ وقدّم الخدمات واطلب النصيحة من الحساب نفسه.',
    ],
    emailTitle: 'ببريد إلكتروني',
    emailFor: 'للشركات والمنظمات، أو لمن ليس لديه رقم هاتف من جنوب السودان.',
    emailList: [
      'أنشئ حسابك ببريدك الإلكتروني وكلمة مرور.',
      'يبدأ الأفراد فوراً، وتُراجَع الشركات أولاً.',
      'اشترِ الآن، وابدأ البيع من الحساب نفسه متى شئت.',
    ],
    create: 'إنشاء حساب',
    signIn: 'تسجيل الدخول',
    staffTitle: 'موظفو كوروادو والمرشدون الزراعيون',
    staffFor:
      'لحسابات يصدرها مسؤول. يدخل الموظفون ببريدهم الإلكتروني، والمرشدون الزراعيون برقم هاتفهم.',
    staffSignIn: 'دخول الموظفين',
    back: 'العودة إلى السوق',
    help: 'المساعدة',
  },
} as const;

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
export function JoinChooser({
  next,
  initialLanguage = DEFAULT_LANGUAGE,
}: {
  next: string;
  initialLanguage?: Language;
}) {
  // 2026-10-31 (Arabic pass): the page reads in the language this browser
  // chose, with the same English / Arabic switch as the sign-in pages.
  const [language, setLanguage] = useLanguageChoice(initialLanguage);
  useDocumentLanguage(language);
  const w = W[language === 'ar' ? 'ar' : 'en'];
  const buyerNext = next.startsWith('/buyer') ? next : '/buyer/marketplace';
  const login = `/login?next=${encodeURIComponent(buyerNext)}`;
  return (
    <main className={styles.wrap} dir={isRtl(language) ? 'rtl' : 'ltr'}>
      <div className={styles.join}>
        <header className={styles.joinHead}>
          <Wordmark size={34} tagline />
          <div className={styles.lang}>
            <LanguageButtons value={language} onChange={setLanguage} />
          </div>
          <h1 className={styles.joinTitle}>{w.title}</h1>
          <p className={styles.joinLead}>{w.lead}</p>
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
            <h2>{w.phoneTitle}</h2>
            <p className={styles.joinFor}>{w.phoneFor}</p>
            <ul className={styles.joinList}>
              {w.phoneList.map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ul>
            <div className={styles.joinActions}>
              <ButtonLink href="/farmer/register">{w.create}</ButtonLink>
              <ButtonLink href="/farmer/login" variant="secondary">
                {w.signIn}
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
            <h2>{w.emailTitle}</h2>
            <p className={styles.joinFor}>{w.emailFor}</p>
            <ul className={styles.joinList}>
              {w.emailList.map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ul>
            <div className={styles.joinActions}>
              <ButtonLink href="/buyer/register">{w.create}</ButtonLink>
              <ButtonLink href={login} variant="secondary">
                {w.signIn}
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
            <h2 id="join-staff">{w.staffTitle}</h2>
            <p className={styles.joinFor}>{w.staffFor}</p>
          </div>
          <ButtonLink href="/admin/login" variant="secondary">
            {w.staffSignIn}
          </ButtonLink>
        </section>

        <p className={styles.joinBack}>
          <a href="/market">{w.back}</a>
          <span aria-hidden> · </span>
          <a href="/help">{w.help}</a>
        </p>
      </div>
    </main>
  );
}
