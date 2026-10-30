<script lang="ts">
  import { authClient } from '#lib/auth-client.ts';
  import { useAuth } from '@mmailaender/convex-better-auth-svelte/svelte';
  const auth = useAuth();
  const session = authClient.useSession();
  let email = $state('');
  let busy = $state(false);
  let sent = $state(false);
  let error = $state('');
  async function signIn(event: SubmitEvent) {
    event.preventDefault();
    if (busy) return;
    busy = true;
    error = '';
    try {
      const result = await authClient.signIn.magicLink({
        email: email.trim(),
        callbackURL: '/?signed_in=1',
        errorCallbackURL: '/?sign_in_error=1',
      });
      if (result.error)
        throw new Error(
          result.error.status === 429
            ? 'Too many requests. Please wait a minute before trying again.'
            : 'Could not send the link. Please try again shortly.',
        );
      sent = true;
    } catch (e) {
      error =
        e instanceof Error ? e.message : 'Sign-in is temporarily unavailable.';
    } finally {
      busy = false;
    }
  }
  async function signOut() {
    busy = true;
    error = '';
    try {
      const result = await authClient.signOut();
      if (result.error)
        throw new Error('Could not sign out. Please try again.');
      sent = false;
    } catch (e) {
      error = e instanceof Error ? e.message : 'Could not sign out.';
    } finally {
      busy = false;
    }
  }
</script>

<div class="mt-4 border-t border-primary/25 pt-4">
  {#if auth.isLoading}<p role="status">Checking your session…</p>
  {:else if auth.isAuthenticated}<p>
      Signed in as <strong>{$session.data?.user.email ?? 'your account'}</strong
      >.
    </p>
    <p>
      Your collage is still saved only in this browser. Animation and checkout
      will be available when their integrations are ready.
    </p>
    <button
      class="btn leading-[1.45] h-auto min-h-[42px] border-primary/20 bg-base-100 px-[11px] py-2 text-sm font-normal text-neutral/90"
      onclick={signOut}
      disabled={busy}>Sign out</button
    >
  {:else}<h3 class="font-serif text-[26px] font-normal">
      Keep your story. Skip the password.
    </h3>
    <p>
      Sign in to prepare for paid animation. Your photos stay on this device.
    </p>
    <form onsubmit={signIn}>
      <label class="mb-[6px] block text-sm" for="signin-email"
        >Email address</label
      >
      <div class="flex flex-wrap gap-2">
        <input
          id="signin-email"
          class="input h-auto min-w-0 flex-1 border-primary/30 p-3 text-base"
          name="email"
          type="email"
          autocomplete="email"
          bind:value={email}
          placeholder="you@example.com"
          required
          maxlength="254"
          disabled={busy}
        /><button
          class="btn leading-[1.45] h-auto min-h-[42px] border-0 btn-primary px-[18px] py-3 text-sm font-normal"
          type="submit"
          disabled={busy}
          >{busy
            ? 'Sending…'
            : sent
              ? 'Send another link'
              : 'Email me a sign-in link'}</button
        >
      </div>
    </form>
    {#if sent}<p role="status">
        If sign-in is available for this address, a link is on its way. Open it
        in this browser within 10 minutes. Check your spam folder too.
      </p>{/if}
  {/if}
  {#if error}<p class="auth-error text-error" role="alert">{error}</p>{/if}
</div>
