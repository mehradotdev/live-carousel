import { expect, it } from 'vite-plus/test';
import { assertOwned, validateUpload, MAX_UPLOAD_BYTES } from '../convex/mediaPolicy';
it('rejects uploads outside the allowed types and sizes', () => {
  expect(() => validateUpload('photo.jpg', 'image/jpeg', MAX_UPLOAD_BYTES)).not.toThrow();
  for (const size of [0, -1, 1.5, Infinity, MAX_UPLOAD_BYTES + 1])
    expect(() => validateUpload('photo.jpg', 'image/jpeg', size)).toThrow();
  expect(() => validateUpload('photo.html', 'text/html', 100)).toThrow();
  expect(() => validateUpload('', 'image/png', 100)).toThrow();
});
it('does not reveal missing, expired, or other-user media', () => {
  const file = { owner: 'alice', expiresAt: 1000 };
  expect(() => assertOwned(file, 'alice', 999)).not.toThrow();
  expect(() => assertOwned(file, 'bob', 999)).toThrow('Media is unavailable');
  expect(() => assertOwned(file, 'alice', 1000)).toThrow('Media is unavailable');
  expect(() => assertOwned(null, 'alice', 999)).toThrow('Media is unavailable');
});
