<script lang="ts">
  import { onMount } from 'svelte';
  import { getShieldLabs, type IdentifyResult, type InteractionIdentifier } from '../../src/lib/index.js';

  interface Props {
    onsubmitted?: (result: IdentifyResult | null) => void;
  }

  const { onsubmitted }: Props = $props();
  const { getAgent } = getShieldLabs();
  let form: HTMLFormElement;
  let early: InteractionIdentifier | undefined;

  onMount(() => {
    let active = true;
    // Arms the form once the agent is loaded: an identification starts on the first interaction.
    getAgent().then(
      (agent) => {
        if (active) early = agent.identifyOnInteraction(form);
      },
      () => undefined,
    );
    return () => {
      active = false;
      early?.dispose();
      early = undefined;
    };
  });

  async function onsubmit(event: SubmitEvent) {
    event.preventDefault();
    let result: IdentifyResult | null = null;
    try {
      // The submission never waits for the agent: before it is loaded, it goes out without a result.
      if (early) result = await early.take();
    } catch {
      result = null;
    }
    onsubmitted?.(result);
  }
</script>

<form bind:this={form} {onsubmit}>
  <input name="email" type="email" aria-label="Email" />
  <button>Sign up</button>
</form>
