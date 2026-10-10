import type { MetadataRoute } from 'next';

/**
 * The web app manifest (2026-10-10, PWA step 1): what makes AgriOne
 * installable -- its name, icons, colours, and where it opens. It opens at
 * /open, which sends each person to their own home (farmer, officer, staff,
 * buyer), or to the last home used on this phone when there is no signal.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    id: '/open',
    name: 'AgriOne South Sudan',
    short_name: 'AgriOne',
    description:
      'Digital agriculture marketplace: farmers list produce, buyers request it, extension officers support the field.',
    start_url: '/open',
    scope: '/',
    display: 'standalone',
    orientation: 'portrait',
    background_color: '#f5f7f1',
    theme_color: '#0f2e1c',
    lang: 'en',
    categories: ['business', 'productivity'],
    icons: [
      { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
      { src: '/icons/maskable-192.png', sizes: '192x192', type: 'image/png', purpose: 'maskable' },
      { src: '/icons/maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
  };
}
