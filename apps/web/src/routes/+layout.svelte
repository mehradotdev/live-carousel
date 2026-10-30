<script lang="ts">
  import '../app.css';
  import favicon from '#lib/assets/favicon.svg';
  import type { LayoutProps } from './$types';
  import { PUBLIC_CONVEX_URL } from '$app/env/public';
  import { createSvelteAuthClient } from '@mmailaender/convex-better-auth-svelte/svelte';
  import { authClient } from '#lib/auth-client.ts';

  let { children, data }: LayoutProps = $props();
  if (PUBLIC_CONVEX_URL)
    createSvelteAuthClient({
      authClient,
      getServerState: () => data.authState,
    });
</script>

<svelte:head>
  <link rel="icon" href={favicon} />
</svelte:head>

{@render children()}
