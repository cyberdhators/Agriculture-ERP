'use client';

import { useState } from 'react';

import { Chips, EmptyState, Stamp } from '@/components/ui';
import { cropsForFarm, totalAreaHa, type Farm } from '@/lib/fixtures/farmers';
import { useFarmerSession } from '@/lib/farmer-session';
import { CROP_LABELS, formatDate } from '@/lib/format';
import { t, type Language, type TKey } from '@/lib/i18n';

import { PageHead } from './AccountShell';
import { PlotMap } from './PlotMap';
import styles from './farmer.module.css';

type Boundary = { label: TKey; kind: 'verified' | 'pending' | 'neutral' };

/** How a plot's boundary stands: walked cleanly, walked at low accuracy, or not walked. */
function boundaryOf(farm: Farm): Boundary {
  const ring = farm.boundary?.coordinates[0];
  const usable = ring && ring.length >= 4 && farm.accuracy_flag !== 'unusable';
  if (!usable) return { label: 'account.boundaryNone', kind: 'neutral' };
  if (farm.accuracy_flag === 'poor') return { label: 'account.boundaryPoor', kind: 'pending' };
  return { label: 'account.boundaryWalked', kind: 'verified' };
}

/**
 * My farm as a survey sheet: one map of the whole holding on the left, a plots
 * table and the selected plot's record on the right. Every plot the officer
 * has walked is drawn to scale; a plot with no walked boundary is listed and
 * accounted for, with an honest note on how boundaries are recorded.
 */
export function FarmerFarm() {
  const { farmer, language } = useFarmerSession();
  // Farm data will come from the farm-mapping API (deliverable (c))
  // once it is wired to the farmer view. Until then, empty state.
  const farms: Farm[] = [];
  const [selected, setSelected] = useState(farms[0]?.id ?? '');
  if (!farmer) return null;

  if (farms.length === 0) {
    return (
      <>
        <PageHead title={t('account.farms', language)} lead={t('account.farmLead', language)} />
        <EmptyState
          title={t('account.noFarms', language)}
          body={t('account.howRecordedBody', language)}
        />
      </>
    );
  }

  const current = farms.find((f) => f.id === selected) ?? farms[0]!;
  const total = totalAreaHa(farmer.id);
  const someUnwalked = farms.some((f) => boundaryOf(f).kind === 'neutral');

  return (
    <>
      <PageHead title={t('account.farms', language)} lead={t('account.farmLead', language)} />
      <div className={styles.survey}>
        <figure className={styles.surveyMap}>
          <PlotMap farms={farms} selectedId={current.id} onSelect={setSelected} lang={language} />
          <figcaption className={styles.surveyCaption}>
            {t('account.selectPlot', language)}
          </figcaption>
        </figure>

        <div className={styles.surveySide}>
          <div className={styles.surveyScroll}>
            <table className={styles.surveyTable}>
              <thead>
                <tr>
                  <th scope="col">{t('account.plotName', language)}</th>
                  <th scope="col" className="num">
                    {t('account.plotArea', language)}
                  </th>
                  <th scope="col">{t('account.plotCrop', language)}</th>
                  <th scope="col">{t('account.plotBoundary', language)}</th>
                </tr>
              </thead>
              <tbody>
                {farms.map((farm, i) => {
                  const b = boundaryOf(farm);
                  const crops = cropsForFarm(farm.id).map((d) => CROP_LABELS[d.crop]);
                  return (
                    <tr
                      key={farm.id}
                      className={farm.id === current.id ? styles.surveyRowOn : styles.surveyRow}
                      aria-selected={farm.id === current.id}
                      onClick={() => setSelected(farm.id)}
                    >
                      <td>
                        <button type="button" className={styles.surveyRowBtn}>
                          {t('account.plot', language)} {i + 1}
                        </button>
                      </td>
                      <td className="num">
                        {farm.area_ha === undefined ? '—' : farm.area_ha.toFixed(2)}
                      </td>
                      <td>{crops.length > 0 ? crops.join(', ') : '—'}</td>
                      <td>
                        <Stamp kind={b.kind}>{t(b.label, language)}</Stamp>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <p className={styles.surveyTotal}>
            <span>{t('account.totalHolding', language)}</span>
            <span className="mono">{total.toFixed(2)} ha</span>
          </p>

          <PlotDetail farm={current} lang={language} />

          {someUnwalked ? (
            <div className={styles.surveyNote}>
              <h3>{t('account.howRecorded', language)}</h3>
              <p>{t('account.howRecordedBody', language)}</p>
            </div>
          ) : null}
        </div>
      </div>
    </>
  );
}

function PlotDetail({ farm, lang }: { farm: Farm; lang: Language }) {
  const crops = cropsForFarm(farm.id).map((d) => CROP_LABELS[d.crop]);
  return (
    <dl className={styles.recordRows}>
      <div className={styles.recordRow}>
        <dt>{t('account.plotSeason', lang)}</dt>
        <dd className={styles.recordValueMono}>{farm.season}</dd>
      </div>
      <div className={styles.recordRow}>
        <dt>{t('account.mapped', lang)}</dt>
        <dd className={styles.recordValueMono}>{formatDate(farm.mapped_at, lang)}</dd>
      </div>
      <div className={styles.recordRow}>
        <dt>{t('account.accuracy', lang)}</dt>
        <dd className={styles.recordValueMono}>
          ±{farm.gps_accuracy_m} m · {farm.point_count} pts
        </dd>
      </div>
      <div className={styles.recordRow}>
        <dt>{t('account.crops', lang)}</dt>
        <dd>
          {crops.length > 0 ? (
            <Chips items={crops} />
          ) : (
            <span className="muted">{t('account.noCrops', lang)}</span>
          )}
        </dd>
      </div>
    </dl>
  );
}
