import type { Metadata } from 'next';

import { FarmerForgotPassword } from '@/components/farmer/FarmerForgotPassword';

export const metadata: Metadata = { title: 'Reset your password' };

export default function FarmerForgotPasswordPage() {
  return <FarmerForgotPassword />;
}
