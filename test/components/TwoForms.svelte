<script lang="ts">
  import type { IdentifyHelper, ShieldLabsOptions, UseIdentifyOptions } from '../../src/lib/index.js';
  import IdentifyButton from './IdentifyButton.svelte';
  import Provider from './Provider.svelte';

  interface Props {
    options: ShieldLabsOptions;
    identifyOptions?: UseIdentifyOptions;
    /** Called with the helper of each form, in document order. */
    onhelper?: (helper: IdentifyHelper) => void;
  }

  const { options, identifyOptions, onhelper }: Props = $props();
</script>

<!-- Two forms of one page, for example checkout and payment: each has its own useIdentify() helper. -->
<Provider {options}>
  <IdentifyButton options={identifyOptions} onsetup={onhelper} label="Checkout" />
  <IdentifyButton options={identifyOptions} onsetup={onhelper} label="Pay" />
</Provider>
