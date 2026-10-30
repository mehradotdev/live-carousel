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

<div class="auth-panel">
  {#if auth.isLoading}<p role="status">Checking your session…</p>
  {:else if auth.isAuthenticated}<p>
      Signed in as <strong>{$session.data?.user.email ?? 'your account'}</strong
      >.
    </p>
    <p>
      Your collage is still saved only in this browser. Animation and checkout
      will be available when their integrations are ready.
    </p>
    <button class="secondary" onclick={signOut} disabled={busy}>Sign out</button
    >
  {:else}<h3>Keep your story. Skip the password.</h3>
    <p>
      Sign in to prepare for paid animation. Your photos stay on this device.
    </p>
    <form onsubmit={signIn}>
      <label for="signin-email">Email address</label>
      <div class="auth-fields">
        <input
          id="signin-email"
          name="email"
          type="email"
          autocomplete="email"
          bind:value={email}
          placeholder="you@example.com"
          required
          maxlength="254"
          disabled={busy}
        /><button class="primary" type="submit" disabled={busy}
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
  {#if error}<p class="auth-error" role="alert">{error}</p>{/if}
</div>

<style>
  .auth-panel {
    border-top: 1px solid #dce2ce;
    padding-top: 16px;
    margin-top: 16px;
  }
  .auth-panel h3 {
    font-family: 'Instrument Serif', Georgia, serif;
    font-weight: 400;
    font-size: 26px;
    margin: 0;
  }
  .auth-panel label {
    display: block;
    font-size: 14px;
    margin-bottom: 6px;
  }
  .auth-fields {
    display: flex;
    gap: 8px;
    flex-wrap: wrap;
  }
  .auth-fields input {
    padding: 12px;
    border: 1px solid #cfd6bc;
    border-radius: 6px;
    min-width: 0;
    flex: 1;
    background: #fffefa;
    color: #30332b;
  }
  .auth-error {
    color: #8d4931;
  }
</style>
