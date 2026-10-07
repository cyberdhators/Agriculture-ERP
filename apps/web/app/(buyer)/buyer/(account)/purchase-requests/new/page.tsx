import { redirect } from 'next/navigation';

/**
 * B14: every request is for a farmer's listed product, sent from the product
 * page or the cart -- there is no third party to search on a buyer's behalf
 * (CORWADO, 2026-10-07). An old link to the free-standing form lands on the
 * marketplace.
 */
export default function NewBuyerRequestPage() {
  redirect('/buyer/marketplace');
}
