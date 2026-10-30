import { ConvexError } from 'convex/values';
export const MAX_UPLOAD_BYTES = 20 * 1024 * 1024;
export const MEDIA_TTL = 7 * 24 * 60 * 60 * 1000;
export function validateUpload(name: string, contentType: string, size: number) {
  if (!name.trim() || name.length > 255) throw new ConvexError('Invalid filename.');
  if (!['image/jpeg', 'image/png', 'image/webp'].includes(contentType))
    throw new ConvexError('Use JPEG, PNG or WebP.');
  if (!Number.isSafeInteger(size) || size <= 0 || size > MAX_UPLOAD_BYTES)
    throw new ConvexError('Photo must be between 1 byte and 20 MB.');
}
export function assertOwned<T extends { owner: string; expiresAt: number }>(
  media: T | null,
  owner: string,
  now: number,
): asserts media is T {
  if (!media || media.owner !== owner || media.expiresAt <= now)
    throw new ConvexError('Media is unavailable.');
}
