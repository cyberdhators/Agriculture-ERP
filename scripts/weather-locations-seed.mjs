// pnpm weather:locations -- one county-level weather location per county (C-16.13).
//
// Idempotent; refuses if any county has no known centroid. Reads and writes the
// database that .env.local points at, so check that twice before running it
// against anything but staging. Never prints a connection string.

import console from 'node:console';
import process from 'node:process';

import { PrismaClient } from '@prisma/client';

import { loadEnvLocal } from './load-env.mjs';
import { seedWeatherLocations } from './weather-locations-lib.mjs';

loadEnvLocal();
const db = new PrismaClient();
try {
  const result = await seedWeatherLocations(db);
  if (result.refused) {
    console.error(`\nREFUSED: ${result.reason}\nNothing was inserted.\n`);
    process.exit(1);
  }
  console.log(
    `\nweather locations: ${result.inserted} inserted, ${result.skipped} already present, ${result.counties} counties.\n`,
  );
} finally {
  await db.$disconnect();
}
