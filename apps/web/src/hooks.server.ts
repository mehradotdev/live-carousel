import type { Handle } from '@sveltejs/kit/hooks';
import { getToken } from '@mmailaender/convex-better-auth-svelte/sveltekit';
import { withServerConvexToken } from 'convex-svelte/sveltekit/server';
export const handle: Handle = ({ event, resolve }) => {
  const token = getToken(event.cookies);
  return withServerConvexToken(token, () => resolve(event));
};
