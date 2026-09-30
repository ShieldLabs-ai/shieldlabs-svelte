<script lang="ts">
  import type { IdentifyHelper, ShieldLabsContext, ShieldLabsOptions, UseIdentifyOptions } from '../../src/lib/index.js';
  import IdentifyButton from './IdentifyButton.svelte';
  import Provider from './Provider.svelte';
  import Status from './Status.svelte';

  interface Props {
    options: ShieldLabsOptions;
    showIdentify?: boolean;
    identifyOptions?: UseIdentifyOptions;
    label?: string;
    onsetup?: (context: ShieldLabsContext) => void;
    onstatus?: (context: ShieldLabsContext) => void;
    onhelper?: (helper: IdentifyHelper) => void;
  }

  const { options, showIdentify = false, identifyOptions, label, onsetup, onstatus, onhelper }: Props = $props();
</script>

<Provider {options} {onsetup}>
  <Status onsetup={onstatus} />
  {#if showIdentify}
    <IdentifyButton options={identifyOptions} onsetup={onhelper} {label} />
  {/if}
</Provider>
