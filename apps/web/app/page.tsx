import { redirect } from 'next/navigation';

/**
 * The public front door is the marketplace. A buyer arriving at the domain
 * sees produce first; a farmer signs in from the marketplace's masthead
 * ("Sign in" → /farmer/login); staff reach their portal by its own address
 * (/login), which is linked from nowhere public on purpose.
 */
export default function Home() {
  redirect('/market');
}
