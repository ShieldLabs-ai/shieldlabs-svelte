<script lang="ts">
  import { enhance } from '$app/forms';
  import { useIdentify } from '@shieldlabs-ai/svelte';
  import type { SubmitFunction } from '@sveltejs/kit';
  import type { PageProps } from './$types';

  const { form }: PageProps = $props();

  const { identify, isLoading, error } = useIdentify();

  // use:enhance sends the form with fetch, so the page stays alive while the agent finishes
  // posting the identification. Every submission gets its own request ID.
  const protect: SubmitFunction = async ({ formData }) => {
    const result = await identify();
    // Without an identification the form is sent anyway: the server treats it as unverified.
    formData.set('requestId', result?.requestId ?? '');
  };
</script>

<svelte:head>
  <title>ShieldLabs signup example (SvelteKit)</title>
</svelte:head>

<h1>Create an account</h1>

<form method="POST" use:enhance={protect}>
  <label>
    Email
    <input name="email" type="email" autocomplete="email" required value={form?.email ?? ''} />
  </label>
  <label>
    Password
    <input name="password" type="password" autocomplete="new-password" required />
  </label>
  <button disabled={$isLoading}>Sign up</button>
</form>

{#if $error}
  <p role="status">No identification ({$error.code}). The signup is sent as unverified.</p>
{/if}
{#if form?.message}
  <p role="status">{form.message}</p>
{/if}

