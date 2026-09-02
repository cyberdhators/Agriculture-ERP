import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // packages/shared ships TypeScript source, so Next must compile it.
  transpilePackages: ['@agri-erp/shared'],
};

export default nextConfig;
