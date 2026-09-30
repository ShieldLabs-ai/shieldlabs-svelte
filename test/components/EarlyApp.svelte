<script lang="ts">
  import type { IdentifyResult, ShieldLabsContext, ShieldLabsOptions } from '../../src/lib/index.js';
  import EarlyForm from './EarlyForm.svelte';
  import Provider from './Provider.svelte';

  interface Props {
    options: ShieldLabsOptions;
    showForm?: boolean;
    onsetup?: (context: ShieldLabsContext) => void;
    onsubmitted?: (result: IdentifyResult | null) => void;
  }

  const { options, showForm = true, onsetup, onsubmitted }: Props = $props();
</script>

<Provider {options} {onsetup}>
  {#if showForm}
    <EarlyForm {onsubmitted} />
  {/if}
</Provider>
