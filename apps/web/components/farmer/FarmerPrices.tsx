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

// Prices will come from the market-prices API once the commodity price
// collection workflow (deliverable (l)) is wired. Until then, empty state.

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

  const prices: readonly PriceRow[] = [];

  return (
    <>
      <PageHead title={t('prices.title', language)} lead={t('prices.lead', language)} />
      {prices.length === 0 ? (
        <EmptyState title={t('prices.empty', language)} body={t('prices.lead', language)} />
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
