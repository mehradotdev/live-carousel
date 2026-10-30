import { R2 } from '@convex-dev/r2';
import { ConvexError, v } from 'convex/values';
import { components, internal } from './_generated/api';
import { action, mutation, query, internalMutation, internalQuery } from './_generated/server';
import { authComponent } from './auth';
import { assertOwned, validateUpload, MEDIA_TTL } from './mediaPolicy';
const r2 = new R2(components.r2);
export const requestUpload = mutation({
  args: { name: v.string(), contentType: v.string(), size: v.number(), consent: v.boolean() },
  handler: async (ctx, args) => {
    const user = await authComponent.getAuthUser(ctx);
    if (!args.consent) throw new ConvexError('Cloud upload requires your consent.');
    validateUpload(args.name, args.contentType, args.size);
    const existing = await ctx.db
      .query('media')
      .withIndex('by_owner', (q) => q.eq('owner', user._id))
      .take(31);
    if (existing.length >= 30)
      throw new ConvexError('Temporary storage limit reached. Delete previous uploads first.');
    const createdAt = Date.now();
    const id = await ctx.db.insert('media', {
      owner: user._id,
      key: '',
      name: args.name,
      contentType: args.contentType,
      size: args.size,
      createdAt,
      expiresAt: createdAt + MEDIA_TTL,
      state: 'pending',
    });
    const key = `inputs/${id}`;
    await ctx.db.patch(id, { key });
    const upload = await r2.generateUploadUrl(key);
    return { id, url: upload.url };
  },
});
export const owned = internalQuery({
  args: { id: v.id('media'), owner: v.string() },
  handler: async (ctx, args) => {
    const media = await ctx.db.get(args.id);
    assertOwned(media, args.owner, Date.now());
    return media;
  },
});
export const markReady = internalMutation({
  args: { id: v.id('media'), owner: v.string() },
  handler: async (ctx, args) => {
    const media = await ctx.db.get(args.id);
    assertOwned(media, args.owner, Date.now());
    if (media.state === 'deleting') throw new ConvexError('Media is being deleted.');
    await ctx.db.patch(args.id, { state: 'ready' });
  },
});
export const finalizeUpload = action({
  args: { id: v.id('media') },
  handler: async (ctx, args): Promise<void> => {
    const user = await authComponent.getAuthUser(ctx);
    const media = await ctx.runQuery(internal.media.owned, { id: args.id, owner: user._id });
    if (media.state === 'deleting') throw new ConvexError('Media is being deleted.');
    await r2.syncMetadata(ctx, media.key);
    const metadata = await r2.getMetadata(ctx, media.key);
    if (!metadata || metadata.size !== media.size || metadata.contentType !== media.contentType) {
      await r2.deleteObject(ctx, media.key);
      throw new ConvexError('Uploaded file does not match the declared type and size.');
    }
    await ctx.runMutation(internal.media.markReady, { id: args.id, owner: user._id });
  },
});
export const downloadUrl = query({
  args: { id: v.id('media') },
  handler: async (ctx, args) => {
    const user = await authComponent.getAuthUser(ctx);
    const media = await ctx.db.get(args.id);
    assertOwned(media, user._id, Date.now());
    if (media.state !== 'ready') throw new ConvexError('Media is not ready.');
    return r2.getUrl(media.key, {
      expiresIn: Math.max(1, Math.min(300, Math.floor((media.expiresAt - Date.now()) / 1000))),
    });
  },
});
export const remove = mutation({
  args: { id: v.id('media') },
  handler: async (ctx, args) => {
    const user = await authComponent.getAuthUser(ctx);
    const media = await ctx.db.get(args.id);
    assertOwned(media, user._id, Date.now());
    await ctx.db.patch(args.id, { state: 'deleting' });
    await r2.deleteObject(ctx, media.key);
    await ctx.db.delete(args.id);
  },
});
export const expire = internalMutation({
  args: {},
  handler: async (ctx) => {
    const expired = await ctx.db
      .query('media')
      .withIndex('by_expiry', (q) => q.lte('expiresAt', Date.now()))
      .take(100);
    for (const media of expired) {
      await r2.deleteObject(ctx, media.key);
      await ctx.db.delete(media._id);
    }
  },
});
