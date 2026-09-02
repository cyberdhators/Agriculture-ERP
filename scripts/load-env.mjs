import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
export const envLocalPath = join(repoRoot, '.env.local');

/**
 * Reads .env.local into process.env.
 *
 * Prisma's CLI reads .env, not .env.local, so every database script goes
 * through here. Values are never printed, logged, or returned -- they only
 * ever reach process.env.
 *
 * Existing environment variables win, so a value exported in the shell
 * overrides the file.
 *
 * @returns {{ ok: true } | { ok: false, reason: string }}
 */
export function loadEnvLocal() {
  if (!existsSync(envLocalPath)) {
    return { ok: false, reason: 'missing' };
  }

  for (const rawLine of readFileSync(envLocalPath, 'utf8').split('\n')) {
    const line = rawLine.trim();
    if (line === '' || line.startsWith('#')) continue;

    const eq = line.indexOf('=');
    if (eq === -1) continue;

    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();

    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }

    if (key !== '' && process.env[key] === undefined) {
      process.env[key] = value;
    }
  }

  return { ok: true };
}
