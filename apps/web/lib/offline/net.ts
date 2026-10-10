/**
 * Was this failure "no signal"? (2026-10-10, PWA.) A fetch that never got an
 * answer throws the browser's own error -- a TypeError, or a DOMException for
 * a timeout or abort -- with no HTTP status; our API errors carry the status
 * the server answered with (0 meaning no answer). Only "no signal" may fall
 * back to a saved copy or the outbox: a real answer (signed out, refused, not
 * allowed) must reach the person, never be papered over.
 */
export function isNoSignal(error: unknown): boolean {
  if (offlineNow()) return true;
  if (typeof error === 'object' && error !== null && 'status' in error) {
    const status = (error as { status: unknown }).status;
    if (typeof status === 'number') return status === 0;
  }
  return error instanceof TypeError || error instanceof DOMException;
}

/** Offline right now, as far as the phone knows. */
export function offlineNow(): boolean {
  return typeof navigator !== 'undefined' && navigator.onLine === false;
}
