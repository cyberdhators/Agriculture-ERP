// Asks OpenWeather for ONE location so a human can read what comes back.
//
//   pnpm weather:verify                  (Juba)
//   pnpm weather:verify 4.85 31.58       (any lat lon)
//
// THROWAWAY, in the shape of pnpm sentry:verify and pnpm sms:verify. Not part
// of C-16; nothing imports it. It exists to turn two things from a prediction
// into an observation before the unit depends on them:
//
//   1. Does the key work? A new OpenWeather key can take a couple of hours to
//      activate and returns 401 until it does. So a 401 on a fresh key means
//      WAIT, not "wrong key" -- this script says so rather than sending you to
//      check a value that is fine.
//   2. Does the free tier serve what C-16 needs? C-16 wants current conditions
//      and a short daily forecast. Two products can supply that: the free
//      Current Weather + 5-day/3-hour forecast (aggregated to days by us), or
//      One Call, which returns daily rows directly and whose free allowance no
//      first-party page would confirm. This calls all three and reports which
//      the key can reach. One Call refusing while 2.5 answers is not an error;
//      it is the answer.
//
// Three calls. Reads only. It never prints the key.

import console from 'node:console';
import { createHash } from 'node:crypto';
import process from 'node:process';

import { loadEnvLocal } from './load-env.mjs';

loadEnvLocal();

const key = process.env.OPENWEATHER_API_KEY ?? '';
if (!key) {
  console.error('\nOPENWEATHER_API_KEY is not set in .env.local. Nothing was called.\n');
  process.exit(1);
}

const [latArg, lonArg] = process.argv.slice(2);
const lat = Number(latArg ?? 4.85);
const lon = Number(lonArg ?? 31.58);
if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) {
  console.error('\nUsage: pnpm weather:verify [lat lon]  (decimal degrees)\n');
  process.exit(1);
}

const label = (k, v) => console.log(`  ${k.padEnd(22)} ${v}`);
const fp = createHash('sha256').update(key).digest('hex').slice(0, 12);

console.log('');
console.log('OpenWeather verification -- three reads for ONE location');
console.log('');
label('location', `${lat}, ${lon}${latArg ? '' : '  (Juba, default)'}`);
label('api key', `set, not printed (sha256: ${fp})`);
console.log('');

const BASE = 'https://api.openweathermap.org';
const calls = [
  {
    name: 'Current Weather (2.5, free plan)',
    url: `${BASE}/data/2.5/weather?lat=${lat}&lon=${lon}&units=metric&appid=${key}`,
    summarise: (b) =>
      `${b.main?.temp}°C, humidity ${b.main?.humidity}%, wind ${b.wind?.speed} m/s, "${b.weather?.[0]?.description}", icon ${b.weather?.[0]?.icon}, station/city "${b.name}"`,
  },
  {
    name: '5-day / 3-hour forecast (2.5, free plan)',
    url: `${BASE}/data/2.5/forecast?lat=${lat}&lon=${lon}&units=metric&appid=${key}`,
    summarise: (b) => {
      const n = b.list?.length ?? 0;
      const first = b.list?.[0];
      const days = new Set((b.list ?? []).map((x) => x.dt_txt?.slice(0, 10))).size;
      return `${n} three-hour slots covering ${days} calendar days; first slot ${first?.dt_txt}: ${first?.main?.temp}°C, pop ${first?.pop}, rain3h ${first?.rain?.['3h'] ?? 0} mm`;
    },
  },
  {
    name: 'One Call 3.0 (daily rows; free allowance unconfirmed)',
    url: `${BASE}/data/3.0/onecall?lat=${lat}&lon=${lon}&units=metric&exclude=minutely,alerts&appid=${key}`,
    summarise: (b) =>
      `${b.daily?.length ?? 0} daily rows; today max ${b.daily?.[0]?.temp?.max}°C min ${b.daily?.[0]?.temp?.min}°C, pop ${b.daily?.[0]?.pop}, rain ${b.daily?.[0]?.rain ?? 0} mm`,
  },
];

const results = [];
for (const c of calls) {
  console.log(`${c.name}`);
  let res;
  let text;
  try {
    res = await globalThis.fetch(c.url);
    text = await res.text();
  } catch (error) {
    label('result', `request failed: ${error.message}`);
    results.push({ name: c.name, status: 0 });
    console.log('');
    continue;
  }
  let body = null;
  try {
    body = JSON.parse(text);
  } catch {
    /* printed raw below */
  }
  label('HTTP', `${res.status} ${res.statusText}`);
  if (res.ok && body) {
    label('summary', c.summarise(body));
  } else {
    label('body', text.slice(0, 200).replace(/\n/g, ' '));
    if (res.status === 401) {
      label(
        'meaning',
        'the key is not accepted HERE. A fresh key activates within ~2 hours; if the',
      );
      label('', 'free 2.5 calls above answered, this product is simply not on the plan.');
    }
  }
  results.push({ name: c.name, status: res.status });
  console.log('');
}

// The answer the unit needs, said plainly.
const s = Object.fromEntries(results.map((r) => [r.name, r.status]));
const current = s['Current Weather (2.5, free plan)'];
const fc = s['5-day / 3-hour forecast (2.5, free plan)'];
const oc = s['One Call 3.0 (daily rows; free allowance unconfirmed)'];
console.log('WHAT THIS MEANS FOR C-16');
if (current === 401 && fc === 401) {
  console.log('  Every call is 401. On a key created today that is activation delay, not a');
  console.log('  wrong key: wait and run this again. Nothing about the plan is known yet.');
} else if (current === 200 && fc === 200) {
  console.log('  The free plan serves both inputs C-16 needs: current conditions, and a');
  console.log('  forecast we aggregate from 3-hour slots into daily rows (max/min temp,');
  console.log('  rain mm summed, rain probability as the daily max of pop).');
  console.log(
    oc === 200
      ? '  One Call ALSO answers, so daily rows are available directly if wanted.'
      : `  One Call returned ${oc}: not on this plan. C-16 does not need it.`,
  );
} else {
  console.log(
    `  Mixed result (current ${current}, forecast ${fc}, one call ${oc}). Read the bodies above.`,
  );
}
console.log('');
