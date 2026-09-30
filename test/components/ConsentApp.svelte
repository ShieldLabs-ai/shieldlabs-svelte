<script lang="ts">
  import { untrack } from 'svelte';
  import { setShieldLabs, type ShieldLabsOptions } from '../../src/lib/index.js';
  import IdentifyButton from './IdentifyButton.svelte';

  interface Props {
    options: ShieldLabsOptions;
    consent: boolean;
    /** Calls load() during initialisation when consent is already given. Default `true`. */
    loadDuringInit?: boolean;
  }

  const { options, consent, loadDuringInit = true }: Props = $props();
  // The consent setup of the README: autoLoad: false, load() during initialisation when consent is
  // known already, and load() from an effect once consent is given.
  const { load } = setShieldLabs(() => options);
  if (untrack(() => loadDuringInit && consent)) load();
  $effect(() => {
    if (consent) load();
  });
</script>

<IdentifyButton options={{ runOnMount: true }} />
