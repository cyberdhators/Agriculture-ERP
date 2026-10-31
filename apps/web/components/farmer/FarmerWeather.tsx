'use client';

import { useFarmerSession } from '@/lib/farmer-session';
import { t } from '@/lib/i18n';

import { PageHead } from './AccountShell';
import { WeatherTile } from './WeatherTile';

export function FarmerWeather() {
  const { farmer, language } = useFarmerSession();
  if (!farmer) return null;

  return (
    <>
      <PageHead title={t('weather.pageTitle', language)} />
      <WeatherTile payamId={farmer.payam_id} language={language} forecastOpen />
    </>
  );
}
