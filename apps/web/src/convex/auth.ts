import { createClient, type GenericCtx } from '@convex-dev/better-auth';
import { convex } from '@convex-dev/better-auth/plugins';
import { betterAuth } from 'better-auth/minimal';
import { magicLink } from 'better-auth/plugins';
import { Resend } from '@convex-dev/resend';
import { components } from './_generated/api';
import type { DataModel } from './_generated/dataModel';
import { query } from './_generated/server';
import authConfig from './auth.config';
export const authComponent = createClient<DataModel>(components.betterAuth);
export const email = new Resend(components.resend, { testMode: false });
export const createAuth = (ctx: GenericCtx<DataModel>) =>
  betterAuth({
    appName: 'Living Carousel',
    baseURL: process.env.SITE_URL,
    secret: process.env.BETTER_AUTH_SECRET,
    database: authComponent.adapter(ctx),
    emailAndPassword: { enabled: false },
    rateLimit: { enabled: true, storage: 'database' },
    plugins: [
      convex({ authConfig }),
      magicLink({
        expiresIn: 600,
        storeToken: 'hashed',
        sendMagicLink: async ({ email: to, url }) => {
          if (!process.env.RESEND_API_KEY || !process.env.AUTH_EMAIL_FROM)
            throw new Error('Email sign-in is not configured yet.');
          if (!('runMutation' in ctx))
            throw new Error('Magic-link sending requires a mutation-capable context.');
          await email.sendEmail(ctx, {
            from: process.env.AUTH_EMAIL_FROM,
            to,
            subject: 'Your Living Carousel sign-in link',
            text: `Sign in to Living Carousel: ${url}\n\nThis link expires in 10 minutes and can be used once. If you did not request it, ignore this email.`,
          });
        },
      }),
    ],
  });
export const currentUser = query({
  args: {},
  handler: async (ctx) => {
    const user = await authComponent.safeGetAuthUser(ctx);
    return user ? { id: user._id, email: user.email, name: user.name } : null;
  },
});
