import { expect, it } from 'vite-plus/test';
import { convexTest } from 'convex-test';
import betterAuth from '@convex-dev/better-auth/test';
import schema from '../convex/schema';
import { api } from '../convex/_generated/api';
const modules = import.meta.glob('../convex/**/*.ts');
function backend() {
  const t = convexTest(schema, modules);
  betterAuth.register(t);
  return t;
}
it('keeps the guest session anonymous and rejects cloud uploads without auth', async () => {
  const t = backend();
  expect(await t.query(api.auth.currentUser, {})).toBeNull();
  await expect(
    t.mutation(api.media.requestUpload, {
      name: 'photo.png',
      size: 100,
      contentType: 'image/png',
      consent: true,
    }),
  ).rejects.toThrow();
});
it('rejects authenticated-looking identities with missing or expired sessions', async () => {
  const t = backend().withIdentity({ subject: 'not-a-real-user', sessionId: 'not-a-real-session' });
  expect(await t.query(api.auth.currentUser, {})).toBeNull();
  await expect(
    t.mutation(api.media.requestUpload, {
      name: 'photo.png',
      size: 100,
      contentType: 'image/png',
      consent: true,
    }),
  ).rejects.toThrow();
});
it('protects media ownership for a real session and rejects upload without consent', async () => {
  const t = backend();
  const now = Date.now();
  const { components } = await import('../convex/_generated/api');
  const user = await t.run((ctx) =>
    ctx.runMutation(components.betterAuth.adapter.create, {
      input: {
        model: 'user',
        data: {
          name: 'Alice',
          email: 'alice@example.com',
          emailVerified: true,
          createdAt: now,
          updatedAt: now,
        },
      },
    }),
  );
  const session = await t.run((ctx) =>
    ctx.runMutation(components.betterAuth.adapter.create, {
      input: {
        model: 'session',
        data: {
          userId: user._id,
          token: 'test-session-only',
          expiresAt: now + 60000,
          createdAt: now,
          updatedAt: now,
        },
      },
    }),
  );
  const alice = t.withIdentity({ subject: user._id, sessionId: session._id });
  expect((await alice.query(api.auth.currentUser, {}))?.email).toBe('alice@example.com');
  await expect(
    alice.mutation(api.media.requestUpload, {
      name: 'photo.png',
      contentType: 'image/png',
      size: 100,
      consent: false,
    }),
  ).rejects.toThrow('consent');
  const id = await t.run((ctx) =>
    ctx.db.insert('media', {
      owner: 'someone-else',
      key: 'private-key',
      name: 'private.png',
      contentType: 'image/png',
      size: 100,
      createdAt: now,
      expiresAt: now + 60000,
      state: 'ready',
    }),
  );
  await expect(alice.query(api.media.downloadUrl, { id })).rejects.toThrow('Media is unavailable');
  await expect(alice.mutation(api.media.remove, { id })).rejects.toThrow('Media is unavailable');
  await expect(alice.action(api.media.finalizeUpload, { id })).rejects.toThrow(
    'Media is unavailable',
  );
});
