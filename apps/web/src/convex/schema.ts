import { defineSchema, defineTable } from 'convex/server';
import { v } from 'convex/values';
export default defineSchema({
  media: defineTable({
    owner: v.string(),
    key: v.string(),
    name: v.string(),
    contentType: v.string(),
    size: v.number(),
    createdAt: v.number(),
    expiresAt: v.number(),
    state: v.union(v.literal('pending'), v.literal('ready'), v.literal('deleting')),
  })
    .index('by_owner', ['owner'])
    .index('by_key', ['key'])
    .index('by_expiry', ['expiresAt']),
});
