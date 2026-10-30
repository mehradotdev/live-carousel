import { afterEach, expect, it, vi } from 'vite-plus/test';
import { convexTest } from 'convex-test';
import betterAuth from '@convex-dev/better-auth/test';
import schema from '../convex/schema';
import { email } from '../convex/auth';
const modules = import.meta.glob('../convex/**/*.ts');
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});
it('issues a magic link, establishes a cookie session and rejects reuse', async () => {
  vi.stubEnv('SITE_URL', 'http://localhost:5173');
  vi.stubEnv('BETTER_AUTH_SECRET', 'test-only-auth-secret-for-component-tests-32bytes');
  vi.stubEnv('RESEND_API_KEY', 'test-only-not-a-real-key');
  vi.stubEnv('AUTH_EMAIL_FROM', 'Test <signin@example.com>');
  let link = '';
  const sender = vi
    .spyOn(email, 'sendEmail')
    .mockImplementation(async (_ctx, options: string | { text?: string }) => {
      if (typeof options !== 'string') link = options.text?.match(/https?:\/\/\S+/)?.[0] ?? '';
      return 'test-email' as Awaited<ReturnType<typeof email.sendEmail>>;
    });
  const t = convexTest(schema, modules);
  betterAuth.register(t);
  const response = await t.fetch('/api/auth/sign-in/magic-link', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: 'http://localhost:5173' },
    body: JSON.stringify({ email: 'test@example.com', callbackURL: '/' }),
  });
  expect(response.status).toBe(200);
  expect(sender).toHaveBeenCalledOnce();
  expect(link).toContain('/magic-link/verify');
  const verified = await t.fetch(new URL(link).pathname + new URL(link).search);
  expect(verified.status).toBe(302);
  const cookies = verified.headers
    .getSetCookie()
    .map((c) => c.split(';')[0])
    .join('; ');
  expect(cookies).toContain('session_token');
  const session = await t.fetch('/api/auth/get-session', { headers: { Cookie: cookies } });
  expect(session.status).toBe(200);
  expect((await session.json()).user.email).toBe('test@example.com');
  const replay = await t.fetch(new URL(link).pathname + new URL(link).search);
  expect(replay.headers.get('location')).toContain('INVALID_TOKEN');
});
