'use client';

import { EmptyState } from '@/components/ui';
import { useFarmerSession } from '@/lib/farmer-session';
import { t } from '@/lib/i18n';

import { PageHead } from './AccountShell';
import styles from './farmer.module.css';

interface PriceRow {
  id: string;
  commodity: string;
  market_name: string;
  price_ssp: number;
  unit: string;
  recorded_on: string;
}

const FIXTURE_PRICES: readonly PriceRow[] = [
  { id: 'p1', commodity: 'Sorghum', market_name: 'Konyokonyo Market', price_ssp: 35000, unit: 'bag_100kg', recorded_on: '2026-09-18' },
  { id: 'p2', commodity: 'Groundnut', market_name: 'Konyokonyo Market', price_ssp: 60000, unit: 'bag_50kg', recorded_on: '2026-09-18' },
  { id: 'p3', commodity: 'Maize', market_name: 'Konyokonyo Market', price_ssp: 28000, unit: 'bag_100kg', recorded_on: '2026-09-17' },
  { id: 'p4', commodity: 'Sesame', market_name: 'Gudele Market', price_ssp: 90000, unit: 'bag_50kg', recorded_on: '2026-09-16' },
  { id: 'p5', commodity: 'Cowpea', market_name: 'Kator Market', price_ssp: 45000, unit: 'bag_50kg', recorded_on: '2026-09-15' },
  { id: 'p6', commodity: 'Okra (fresh)', market_name: 'Konyokonyo Market', price_ssp: 800, unit: 'kg', recorded_on: '2026-09-18' },
  { id: 'p7', commodity: 'Tomato', market_name: 'Gudele Market', price_ssp: 1200, unit: 'crate', recorded_on: '2026-09-17' },
];

const UNIT_LABEL: Record<string, string> = {
  kg: 'kg',
  bag_50kg: '50 kg bag',
  bag_100kg: '100 kg bag',
  sack: 'sack',
  crate: 'crate',
  bunch: 'bunch',
  piece: 'piece',
  head: 'head',
  litre: 'litre',
  tin: 'tin',
};

function formatSsp(amount: number): string {
  return new Intl.NumberFormat('en-GB', { maximumFractionDigits: 0 }).format(amount);
}

export function FarmerPrices() {
  const { language } = useFarmerSession();

  const prices = FIXTURE_PRICES;

  return (
    <>
      <PageHead
        title={t('prices.title', language)}
        lead={t('prices.lead', language)}
      />
      {prices.length === 0 ? (
        <EmptyState
          title={t('prices.empty', language)}
          body={t('prices.lead', language)}
        />
      ) : (
        <div className={styles.priceTableWrap}>
          <table className={styles.priceTable}>
            <thead>
              <tr>
                <th>{t('prices.commodity', language)}</th>
                <th>{t('prices.market', language)}</th>
                <th className={styles.priceNum}>{t('prices.price', language)}</th>
                <th>{t('prices.unit', language)}</th>
                <th>{t('prices.date', language)}</th>
              </tr>
            </thead>
            <tbody>
              {prices.map((row) => (
                <tr key={row.id}>
                  <td>{row.commodity}</td>
                  <td>{row.market_name}</td>
                  <td className={`${styles.priceNum} mono`}>{formatSsp(row.price_ssp)}</td>
                  <td>{UNIT_LABEL[row.unit] ?? row.unit}</td>
                  <td className="mono">{row.recorded_on}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
