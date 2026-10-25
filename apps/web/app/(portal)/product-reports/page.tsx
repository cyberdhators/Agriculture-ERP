import type { Metadata } from 'next';

import { CorrectionRequests } from '@/components/admin/Corrections';
import { MarketReports } from '@/components/market-posts/MarketReports';
import { ProductReports } from '@/components/product-reports/ProductReports';

export const metadata: Metadata = { title: 'Product reports' };

export default function ProductReportsPage() {
  return (
    <>
      <ProductReports />
      {/* LISTINGS LANE (2026-10-19): buying requests and services reported. */}
      <MarketReports />
      {/* 2026-10-27: correction requests and whether their owners have acted. */}
      <CorrectionRequests />
    </>
  );
}
