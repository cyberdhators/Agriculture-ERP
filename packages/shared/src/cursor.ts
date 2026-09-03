/**
 * The cursor format. Unit B3, and what finally makes `invalid_cursor` reachable.
 *
 * CONVENTIONS section 6.2 fixes the sort as created_at descending, then id
 * descending. A cursor is therefore the (created_at, id) of the last row on the
 * page: the next page is everything ordered strictly after it.
 *
 * It is OPAQUE to clients. Base64url of a compact JSON pair, not because that
 * hides anything — anyone can decode it — but because a client that can read a
 * cursor starts constructing one, and then the format cannot change.
 */

export interface Cursor {
  readonly createdAt: string;
  readonly id: string;
}

const toBase64Url = (value: string): string =>
  Buffer.from(value, 'utf8')
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');

const fromBase64Url = (value: string): string =>
  Buffer.from(value.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8');

export function encodeCursor(cursor: Cursor): string {
  return toBase64Url(JSON.stringify([cursor.createdAt, cursor.id]));
}

/**
 * Decodes a cursor, or returns null if it is unreadable.
 *
 * Null is the caller's signal to return 400 `invalid_cursor`. A corrupted
 * cursor is NOT silently treated as page one: a client whose cursor has been
 * mangled would otherwise re-read the first page forever and never know.
 */
export function decodeCursor(value: string): Cursor | null {
  try {
    const parsed: unknown = JSON.parse(fromBase64Url(value));
    if (!Array.isArray(parsed) || parsed.length !== 2) return null;
    const [createdAt, id] = parsed;
    if (typeof createdAt !== 'string' || typeof id !== 'string') return null;
    // A timestamp that is not a timestamp would make the SQL comparison throw
    // at the database rather than here, which is a 500 for the caller's mistake.
    if (Number.isNaN(Date.parse(createdAt))) return null;
    if (id === '') return null;
    return { createdAt, id };
  } catch {
    return null;
  }
}

/**
 * ISO 8601 UTC with milliseconds and a Z, per CONVENTIONS section 7.
 *
 * Postgres hands back a Date; `toISOString` is exactly that format. Written as
 * one function so the rule has one home rather than a `.toISOString()` scattered
 * through every route.
 */
export const toIso = (value: Date): string => value.toISOString();
