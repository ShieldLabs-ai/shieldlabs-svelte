<script lang="ts">
  import { onMount } from 'svelte';
  import { getShieldLabs, type InteractionIdentifier } from '@shieldlabs-ai/svelte';
  import type { PageProps } from './$types';

  const { form }: PageProps = $props();

  const { getAgent } = getShieldLabs();
  let formElement: HTMLFormElement;
  let requestIdField: HTMLInputElement;
  let early: InteractionIdentifier | undefined;

  onMount(() => {
    let active = true;
    // Once the agent is loaded, starts an identification on the first focus, pointer or key event
    // inside the form, so that it has finished, and the agent has posted it, before the page
    // navigates away. getAgent() has no timeout of its own, so the submit handler never waits for it.
    getAgent().then(
      (agent) => {
        if (active) early = agent.identifyOnInteraction(formElement);
      },
      () => {}, // no agent: the form is sent without a requestId
    );
    return () => {
      active = false;
      early?.dispose();
    };
  });

  async function onsubmit(event: SubmitEvent) {
    event.preventDefault();
    try {
      // The early identification while it is fresh, otherwise a new one.
      if (early) requestIdField.value = (await early.take()).requestId;
    } catch {
      // Without an identification the form is sent anyway: the server treats it as unverified.
    }
    formElement.submit();
  }
</script>

<svelte:head>
  <title>ShieldLabs signup example, full-page form post (SvelteKit)</title>
</svelte:head>

<h1>Create an account</h1>
<p>This form is sent as a full-page post, without <code>use:enhance</code>.</p>

<form bind:this={formElement} method="POST" {onsubmit}>
  <label>
    Email
    <input name="email" type="email" autocomplete="email" required value={form?.email ?? ''} />
  </label>
  <label>
    Password
    <input name="password" type="password" autocomplete="new-password" required />
  </label>
  <input bind:this={requestIdField} type="hidden" name="requestId" />
  <button>Sign up</button>
</form>

{#if form?.message}
  <p role="status">{form.message}</p>
{/if}
