import { DEVICE_ID_HEADER, DEVICE_ID_PATTERN } from '@agri-erp/shared';

/**
 * This installation's id (C-9.8), sent as x-device-id with every upload so
 * the server's audit can say which phone a change came from. Made once, kept
 * in this browser; never the handset's hardware identity.
 */
const KEY = 'agrione.deviceId';

export function deviceId(): string {
  try {
    const kept = window.localStorage.getItem(KEY);
    if (kept && DEVICE_ID_PATTERN.test(kept)) return kept;
    const made = `pwa-${crypto.randomUUID()}`;
    window.localStorage.setItem(KEY, made);
    return made;
  } catch {
    return 'pwa-unknown-device';
  }
}

export { DEVICE_ID_HEADER };
