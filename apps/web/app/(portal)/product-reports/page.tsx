import type { Metadata } from 'next';

import { MarketReports } from '@/components/market-posts/MarketReports';
import { ProductReports } from '@/components/product-reports/ProductReports';

export const metadata: Metadata = { title: 'Product reports' };

export default function ProductReportsPage() {
  return (
    <>
      <ProductReports />
      {/* LISTINGS LANE (2026-10-19): buying requests and services reported. */}
      <MarketReports />
    </>
  );
}
