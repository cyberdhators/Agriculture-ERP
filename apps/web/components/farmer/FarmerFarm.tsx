'use client';

import { Boundary } from '@/components/farmers/Boundary';
import { Chips, EmptyState } from '@/components/ui';
import { cropsForFarm, farmsForFarmer } from '@/lib/fixtures/farmers';
import { useFarmerSession } from '@/lib/farmer-session';
import { CROP_LABELS, formatDate } from '@/lib/format';
import { t } from '@/lib/i18n';

import { PageHead } from './AccountShell';
import styles from './farmer.module.css';

/**
 * My farm: every plot an officer has walked, as the same inline-SVG boundary
 * the staff dossier draws, at dossier size, with area, season, mapping date,
 * GPS accuracy and the crops declared on it.
 */
export function FarmerFarm() {
  const { farmer, language } = useFarmerSession();
  if (!farmer) return null;
  const farms = farmsForFarmer(farmer.id);

  return (
    <>
      <PageHead title={t('account.farms', language)} lead={t('account.farmLead', language)} />
      {farms.length === 0 ? (
        <EmptyState title={t('account.noFarms', language)} body="" />
      ) : (
        <div className={styles.plotGrid}>
          {farms.map((farm, i) => {
            const crops = cropsForFarm(farm.id).map((d) => CROP_LABELS[d.crop]);
            return (
              <article key={farm.id} className={styles.plotCard}>
                <Boundary farm={farm} size={240} />
                <div>
                  <h3>
                    {t('account.plot', language)} {i + 1}
                  </h3>
                  <dl className={styles.recordRows}>
                    <div className={styles.recordRow}>
                      <dt>{t('account.area', language)}</dt>
                      <dd className={styles.recordValueMono}>{farm.area_ha.toFixed(2)} ha</dd>
                    </div>
                    <div className={styles.recordRow}>
                      <dt>{t('account.mapped', language)}</dt>
                      <dd className={styles.recordValueMono}>
                        {formatDate(farm.mapped_at)} · {farm.season}
                      </dd>
                    </div>
                    <div className={styles.recordRow}>
                      <dt>{t('account.accuracy', language)}</dt>
                      <dd className={styles.recordValueMono}>
                        ±{farm.gps_accuracy_m} m · {farm.point_count} pts
                      </dd>
                    </div>
                    <div className={styles.recordRow}>
                      <dt>{t('account.crops', language)}</dt>
                      <dd>
                        {crops.length > 0 ? (
                          <Chips items={crops} />
                        ) : (
                          <span className="muted">{t('account.noCrops', language)}</span>
                        )}
                      </dd>
                    </div>
                  </dl>
                </div>
              </article>
            );
          })}
        </div>
      )}
    </>
  );
}
