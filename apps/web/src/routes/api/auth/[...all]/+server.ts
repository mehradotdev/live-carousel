import { createSvelteKitHandler } from '@mmailaender/convex-better-auth-svelte/sveltekit';
import { PUBLIC_CONVEX_SITE_URL, PUBLIC_CONVEX_URL } from '$app/env/public';
import type { RequestHandler } from './$types';
const handle: RequestHandler = async (event) => {
  if (!PUBLIC_CONVEX_URL)
    return Response.json({ message: 'Sign-in is not configured yet.' }, { status: 503 });
  const handlers = createSvelteKitHandler(
    PUBLIC_CONVEX_SITE_URL ? { convexSiteUrl: PUBLIC_CONVEX_SITE_URL } : {},
  );
  try {
    return await handlers[event.request.method === 'GET' ? 'GET' : 'POST'](event);
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError')
      return new Response(null, { status: 499 });
    throw error;
  }
};
export { handle as GET, handle as POST };
