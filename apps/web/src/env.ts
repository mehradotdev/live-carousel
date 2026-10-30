import { defineEnvVars } from '@sveltejs/kit/env';
export const variables = defineEnvVars({
  PUBLIC_CONVEX_URL: { public: true, static: true, default: '' },
  PUBLIC_CONVEX_SITE_URL: { public: true, static: true, default: '' },
});
