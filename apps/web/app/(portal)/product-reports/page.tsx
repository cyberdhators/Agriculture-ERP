import type { Metadata } from 'next';

import { ProductReports } from '@/components/product-reports/ProductReports';

export const metadata: Metadata = { title: 'Product reports' };

export default function ProductReportsPage() {
  return <ProductReports />;
}
