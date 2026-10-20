import {
  PROFILE_PHOTO_LIMITS,
  type PublicProfileOwn,
  type PublicProfileSave,
  type PublicProfileView,
} from '@agri-erp/shared';

/**
 * PUBLIC PROFILES V2 (2026-10-23) -- the screens' calls. Every read and write
 * goes through the API; the photo's bytes go straight to the private bucket on
 * a grant the API issued for one path, then the API checks what arrived.
 */

export class ProfileError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly fields: Record<string, string> = {},
  ) {
    super(message);
  }
}

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(path, {
      cache: 'no-store',
      ...init,
      headers: init?.body ? { 'content-type': 'application/json' } : undefined,
    });
  } catch {
    throw new ProfileError(0, 'The server could not be reached. Check the connection.');
  }
  const body = (await res.json().catch(() => ({}))) as {
    data?: T;
    error?: { message?: string; fields?: Record<string, string> };
  };
  if (!res.ok || body.data === undefined) {
    throw new ProfileError(
      res.status,
      body.error?.message ?? `The request failed (${res.status}).`,
      body.error?.fields ?? {},
    );
  }
  return body.data;
}

const BASE = '/api/account/public-profile';
const post = (body: unknown): RequestInit => ({ method: 'POST', body: JSON.stringify(body) });

export const getMyPublicProfile = () => call<PublicProfileOwn>(BASE);

export const saveMyPublicProfile = (body: PublicProfileSave) =>
  call<PublicProfileOwn>(BASE, { method: 'PUT', body: JSON.stringify(body) });

export const publishMyPublicProfile = () => call<PublicProfileOwn>(`${BASE}/publish`, post({}));

export const unpublishMyPublicProfile = () => call<PublicProfileOwn>(`${BASE}/unpublish`, post({}));

export const removeMyPhoto = () => call<PublicProfileOwn>(`${BASE}/photo`, { method: 'DELETE' });

export const getPublicProfile = (publicId: string) =>
  call<PublicProfileView>(`/api/profiles/p/${encodeURIComponent(publicId)}`);

/**
 * Shrinks a photo on the phone to at most 800 px on its long side, as JPEG,
 * before anything is sent: small enough for a weak signal and well under the
 * 2 MB ceiling. A second, smaller pass if the first is still too big.
 */
export async function shrinkProfilePhoto(file: File): Promise<Blob> {
  const bitmap = await createImageBitmap(file);
  const draw = (max: number, quality: number) =>
    new Promise<Blob>((resolve, reject) => {
      const scale = Math.min(1, max / Math.max(bitmap.width, bitmap.height));
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.round(bitmap.width * scale));
      canvas.height = Math.max(1, Math.round(bitmap.height * scale));
      canvas.getContext('2d')!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
      canvas.toBlob(
        (blob) => (blob ? resolve(blob) : reject(new Error('The photo could not be read.'))),
        'image/jpeg',
        quality,
      );
    });
  try {
    let blob = await draw(PROFILE_PHOTO_LIMITS.maxPixels, 0.82);
    if (blob.size > PROFILE_PHOTO_LIMITS.maxBytes) blob = await draw(600, 0.7);
    return blob;
  } finally {
    bitmap.close();
  }
}

/** Grant, upload straight to the bucket, confirm. Returns the saved profile. */
export async function uploadMyPhoto(photo: Blob): Promise<PublicProfileOwn> {
  const grant = await call<{ upload_id: string; url: string; token: string }>(
    `${BASE}/photo/upload-url`,
    post({ content_type: 'image/jpeg', byte_size: photo.size }),
  );
  let res: Response;
  try {
    res = await fetch(grant.url, {
      method: 'PUT',
      headers: { 'content-type': 'image/jpeg' },
      body: photo,
    });
  } catch {
    throw new ProfileError(0, 'The photo could not be sent. Check the connection and try again.');
  }
  if (!res.ok) {
    throw new ProfileError(res.status, 'The photo could not be sent. Try again.');
  }
  return call<PublicProfileOwn>(
    `${BASE}/photo/confirm`,
    post({ upload_id: grant.upload_id, content_type: 'image/jpeg' }),
  );
}

/** Two letters for the initials disc when there is no photo. */
export function initialsOf(name: string | null | undefined): string {
  const words = (name ?? '').trim().split(/\s+/).filter(Boolean);
  const letters = words.length > 1 ? [words[0]!, words[words.length - 1]!] : words.slice(0, 1);
  return (
    letters
      .map((w) => Array.from(w)[0] ?? '')
      .join('')
      .toUpperCase() || '?'
  );
}
