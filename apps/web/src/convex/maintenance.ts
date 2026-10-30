import { internalMutation } from './_generated/server';
import { components } from './_generated/api';
export const cleanEmailHistory = internalMutation({
  args: {},
  handler: async (ctx) => {
    await ctx.runMutation(components.resend.lib.cleanupOldEmails, {
      olderThan: 7 * 24 * 60 * 60 * 1000,
    });
    await ctx.runMutation(components.resend.lib.cleanupAbandonedEmails, {
      olderThan: 7 * 24 * 60 * 60 * 1000,
    });
  },
});
