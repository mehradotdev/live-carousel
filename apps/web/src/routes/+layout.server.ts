import { getAuthState } from '@mmailaender/convex-better-auth-svelte/sveltekit';
export const load = () => ({ authState: getAuthState() });
