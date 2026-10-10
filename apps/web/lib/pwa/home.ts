/**
 * The last home this phone opened (2026-10-10, PWA step 1), so the installed
 * app knows where to open with no signal. A path only -- never who it was or
 * anything they saw. A convenience: if storage is blocked it simply is absent.
 */
const KEY = 'agrione.pwa.lastHome';

export function rememberHome(path: string): void {
  try {
    window.localStorage.setItem(KEY, path);
  } catch {
    // Private window or storage blocked.
  }
}

export function lastHome(): string | null {
  try {
    const value = window.localStorage.getItem(KEY);
    return value && value.startsWith('/') && !value.startsWith('//') ? value : null;
  } catch {
    return null;
  }
}
