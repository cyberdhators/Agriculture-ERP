import type { Metadata } from 'next';

import { FarmerWeather } from '@/components/farmer/FarmerWeather';

export const metadata: Metadata = { title: 'Weather' };

export default function WeatherPage() {
  return <FarmerWeather />;
}
