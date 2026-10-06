import type { Metadata } from 'next';

import { BuyerRegister } from '@/components/buyer/BuyerRegister';

export const metadata: Metadata = { title: 'Apply for a buyer account' };

/** Outside the buyer shell and outside the session gate: the applicant has no account yet. */
export default function BuyerRegisterPage() {
  return <BuyerRegister />;
}
