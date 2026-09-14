// Sends ONE SMS through Bird so a human can read what the gateway returns.
//
//   pnpm sms:verify +211XXXXXXXXX
//   pnpm sms:verify +211XXXXXXXXX --arabic
//   pnpm sms:verify +231XXXXXXXXX
//
// THROWAWAY. This is not deliverable (n) and not a unit: (n) is phase 6 and
// C-15 does not exist. Nothing in the application imports this file, and
// deleting it plus its package.json line removes every trace of Bird from the
// repository.
//
// WHY IT EXISTS. Bird's own destinations page lists South Sudan as reachable
// and publishes a rate for it, but it names NO mobile network operator. MTN,
// Zain and Digitel are not mentioned anywhere in their documentation. So
// country-level coverage is documented and operator-level coverage is not, and
// the only way to close that is to send to a real handset on each network and
// look. Same purpose as pnpm sentry:verify: turn a prediction into an
// observation before anything depends on it.
//
// RUN IT ONCE PER NETWORK. One message to one number proves one operator. To
// say I-02 is satisfied for South Sudan you need three runs: an MTN number, a
// Zain number and a Digitel number.
//
// TWO DESTINATIONS ARE ACCEPTED, and the difference between them is worth
// knowing before reading a result. Bird offers South Sudan an alphanumeric
// sender ONLY, one-way, and no two-way messaging at all. Liberia it offers both
// an alphanumeric sender and a long code, and two-way IS supported there. So a
// refusal on +231 and a refusal on +211 do not mean the same thing, and a
// success on +231 says nothing about +211.
//
// WHAT IT PROVES: that Bird accepts the request, what sender it accepted, how
// many segments it billed, which encoding it chose, and what it says the cost
// is. WHAT IT DOES NOT PROVE: that the handset rang. The response is Bird's
// acceptance, not a delivery receipt -- so read the phone, and read the
// message's final status in the Bird dashboard afterwards.
//
// It never prints the API key.

import console from 'node:console';
import { createHash } from 'node:crypto';
import process from 'node:process';

import { loadEnvLocal } from './load-env.mjs';

loadEnvLocal();

const REQUIRED = ['BIRD_API_KEY', 'BIRD_API_BASE_URL', 'BIRD_SMS_SENDER_ID'];
const missing = REQUIRED.filter((n) => (process.env[n] ?? '') === '');
if (missing.length > 0) {
  console.error('');
  console.error(`Not set in .env.local: ${missing.join(', ')}`);
  console.error('');
  console.error('  BIRD_API_KEY        the bearer token (secret; never NEXT_PUBLIC_)');
  console.error('  BIRD_API_BASE_URL   your workspace region, e.g. https://us1.platform.bird.com');
  console.error('  BIRD_SMS_SENDER_ID  the alphanumeric sender, 3-11 chars, >=1 letter');
  console.error('');
  console.error('Nothing was sent.');
  process.exit(1);
}

// The only destinations this script will message. A wrong digit here messages a
// stranger, and the cost of that is not the $0.21. Widening this list is a
// deliberate edit, which is the point of it being a list.
const ACCEPTED_PREFIXES = [
  { prefix: '+211', country: 'South Sudan' },
  { prefix: '+231', country: 'Liberia' },
];

/** The published alphanumeric rate per segment, by prefix (2026-09-14). */
const PUBLISHED_RATE_USD = { '+211': 0.21, '+231': 0.21 };

const args = process.argv.slice(2);
const to = args.find((a) => !a.startsWith('--'));
const arabic = args.includes('--arabic');
const force = args.includes('--force');
const smart = args.includes('--smart-encoding');

if (!to) {
  console.error('\nUsage: pnpm sms:verify +211XXXXXXXXX [--arabic] [--smart-encoding]\n');
  process.exit(1);
}
if (!/^\+\d{7,15}$/.test(to)) {
  console.error(`\n"${to}" is not E.164 (a leading + and 7 to 15 digits). Nothing was sent.\n`);
  process.exit(1);
}
const destination = ACCEPTED_PREFIXES.find((p) => to.startsWith(p.prefix));
if (!destination && !force) {
  console.error('');
  console.error(`${to} is not a destination this script will message.`);
  console.error('');
  console.error('  It accepts only:');
  for (const p of ACCEPTED_PREFIXES) {
    console.error(`    ${p.prefix.padEnd(6)} ${p.country}`);
  }
  console.error('');
  console.error('A wrong digit here messages a stranger, which is why the list is short.');
  console.error('Pass --force if you genuinely mean a different country.');
  console.error('');
  console.error('Nothing was sent.');
  process.exit(1);
}

// Two bodies, chosen to make the encoding question visible rather than argued.
// The Latin one is GSM-7: 160 characters in one segment. The Arabic one is
// Arabic script, which has no GSM-7 representation, so it is UCS-2: 70
// characters in one segment, 67 per segment once it concatenates.
const LATIN = 'CORWADO test message. Ignore this. Reply not possible.';
const ARABIC = 'رسالة اختبار من كورwado. تجاهل هذه الرسالة. لا يمكن الرد عليها.';
const text = arabic ? ARABIC : LATIN;

const baseUrl = process.env.BIRD_API_BASE_URL.replace(/\/+$/, '');

// A GATE THAT COMPARES, rather than a round trip to find out. A Bird key is
// `bk_{region}_{payload}` and is bound to that region's host, so the key states
// which host it belongs to and the config states which host we will call. Two
// sources that can drift apart, checked against each other before anything is
// sent. The first run of this script spent a request discovering that an
// eu1 key had been pointed at us1 -- and Bird answered 401 "InvalidAPIKey",
// not the 421 Misdirected Request its own documentation promises for a wrong
// region, so the round trip was actively misleading.
const keyRegion = (process.env.BIRD_API_KEY.match(/^bk_([a-z0-9]+)_/) ?? [])[1];
const hostRegion = (baseUrl.match(/^https:\/\/([a-z0-9]+)\./) ?? [])[1];
if (keyRegion && hostRegion && keyRegion !== hostRegion) {
  console.error('');
  console.error('The API key and the base URL disagree about the region.');
  console.error('');
  console.error(`  BIRD_API_KEY       is a ${keyRegion} key (from its bk_${keyRegion}_ prefix)`);
  console.error(`  BIRD_API_BASE_URL  points at ${hostRegion}: ${baseUrl}`);
  console.error('');
  console.error(`  A Bird key only works against its own region. Set BIRD_API_BASE_URL to`);
  console.error(`  https://${keyRegion}.platform.bird.com, or use a ${hostRegion} key.`);
  console.error('');
  console.error('Nothing was sent.');
  process.exit(1);
}

const endpoint = `${baseUrl}/v1/sms/messages`;
const body = {
  to,
  from: process.env.BIRD_SMS_SENDER_ID,
  text,
  category: 'authentication',
  // Off by default ON PURPOSE: smart encoding rewrites characters that have a
  // GSM-7 near-equivalent (curly quotes, dashes) to keep a message in one
  // segment. It cannot do that for Arabic script, which has no GSM-7 form. We
  // want the true encoding this text produces, not a rescued one.
  options: { smart_encoding: smart },
};

const label = (k, v) => console.log(`  ${k.padEnd(22)} ${v}`);

console.log('');
console.log('Bird SMS verification -- ONE message, sent now');
console.log('');
label('endpoint', endpoint);
label('to', `${to}  (${destination ? destination.country : 'FORCED, unlisted country'})`);
label('from', body.from);
label('script', arabic ? 'Arabic (expect UCS-2)' : 'Latin (expect GSM-7)');
label('characters', String([...text].length));
label('smart_encoding', String(smart));
// A non-secret fingerprint of the key, so two runs can be compared. Bird
// scopes are chosen at creation, so fixing a scope means a NEW key -- and the
// question "did the key actually change?" came up twice before this line
// existed, each time costing a round trip to answer.
label(
  'api key',
  `set, not printed (sha256: ${createHash('sha256').update(process.env.BIRD_API_KEY).digest('hex').slice(0, 12)})`,
);
console.log('');
console.log(`  text: ${text}`);
console.log('');

let response;
let raw;
try {
  // globalThis.fetch, not bare fetch: Node has had it global since 18, but the
  // lint config's globals for scripts/*.mjs do not list it, and adding it there
  // would change a shared config for one throwaway file.
  response = await globalThis.fetch(endpoint, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${process.env.BIRD_API_KEY}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify(body),
  });
  raw = await response.text();
} catch (error) {
  console.error(`The request itself failed: ${error.message}`);
  console.error('Nothing is known about delivery. Check the base URL and the network.');
  process.exit(1);
}

let parsed = null;
try {
  parsed = JSON.parse(raw);
} catch {
  /* not JSON; the raw body is printed below */
}

console.log(`HTTP ${response.status} ${response.statusText}`);
console.log('');
console.log(raw.length > 0 ? raw : '(empty body)');
console.log('');

if (!response.ok) {
  // The advice must match the status. The first version of this block printed
  // guidance about a 422 and about +211 whatever had happened -- so a 401 on a
  // Liberian number came with a paragraph about South Sudan sender types. A
  // check pointed at the wrong thing, in the error path of the script written
  // to prove things (docs/PROJECT-STATE.md, the third pattern).
  console.error('REFUSED. Nothing was delivered and nothing was billed.');
  console.error('');
  if (response.status === 401) {
    console.error('  IDENTITY. Bird does not accept the credential at all, so this run');
    console.error('  says nothing about coverage, the sender, or segments.');
    console.error('');
    console.error('    1. BIRD_API_KEY copied whole, including its bk_{region}_ prefix.');
    console.error(`    2. The host matches the key's region. This run used ${baseUrl}.`);
    console.error('    3. The key still exists and has not been rotated or deleted.');
  } else if (response.status === 403) {
    console.error('  PERMISSION, not identity. The credential is real and Bird knows it;');
    console.error('  it has not been granted what this request needs. Read `param` in the');
    console.error('  body above -- for sending, the scope is `sms:write`.');
    console.error('');
    console.error('  Grant the scope to this key in the Bird dashboard, or create a key');
    console.error('  that has it. Nothing about coverage or the sender is known yet: the');
    console.error('  request was refused before either was considered.');
  } else if (response.status === 422) {
    console.error('  Bird accepted the credential and refused the REQUEST.');
    console.error('  The usual cause is the sender: an alphanumeric sender must be 3-11');
    console.error('  characters with at least one letter, and the destination country');
    console.error('  must permit that sender type. For +211 Bird lists an alphanumeric');
    console.error('  sender only -- no long code, no shortcode -- so a purchased number');
    console.error('  cannot be the sender there. For +231 both are listed.');
    console.error(`  This run sent from: ${body.from}`);
  } else if (response.status === 429) {
    console.error('  Rate limited. Nothing is known about coverage. Wait and repeat.');
  } else {
    console.error('  Read the body above. The status was not one this script has advice');
    console.error('  for, which is itself worth reporting rather than guessing about.');
  }
  console.error('');
  process.exit(1);
}

// What we actually came for.
const segments = parsed?.segments ?? {};
console.log('WHAT THE GATEWAY SAID');
console.log('');
label('message id', parsed?.id ?? '(none returned)');
label('status', parsed?.status ?? '(none returned)');
label('segments billed', segments.count ?? '(not reported)');
label('encoding', segments.encoding ?? '(not reported)');
label('cost', parsed?.cost ? JSON.stringify(parsed.cost) : '(not reported)');
console.log('');

const rate = destination ? PUBLISHED_RATE_USD[destination.prefix] : undefined;
if (typeof segments.count === 'number' && rate !== undefined) {
  // Arithmetic only. The authority is the `cost` field above and the invoice.
  const total = segments.count * rate;
  console.log(
    `  at the published $${rate.toFixed(2)}/segment for ${destination.country} that is ` +
      `$${total.toFixed(4)} for this one message`,
  );
  console.log(`  so 1,000 messages of this shape would be $${(total * 1000).toFixed(2)}`);
  console.log('');
}

console.log('NOT PROVED BY THIS OUTPUT: that the handset rang. The response above is');
console.log('Bird accepting the message, not a delivery receipt. Look at the phone, and');
console.log("look at the message's final status in Bird's dashboard.");
console.log('');
