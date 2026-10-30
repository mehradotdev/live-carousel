import { initConvex } from 'convex-svelte/sveltekit';
import { PUBLIC_CONVEX_URL } from '$app/env/public';
if (PUBLIC_CONVEX_URL) initConvex(PUBLIC_CONVEX_URL);
