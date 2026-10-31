import { defineEnvVars } from '@sveltejs/kit/env';
// Convex is optional: the free editor builds and runs without it.
const optional = (value: string | undefined) => value ?? '';
export const variables = defineEnvVars({
  PUBLIC_CONVEX_URL: { public: true, static: true, schema: optional },
  PUBLIC_CONVEX_SITE_URL: { public: true, static: true, schema: optional },
});
