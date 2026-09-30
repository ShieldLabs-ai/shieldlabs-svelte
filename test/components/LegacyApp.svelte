<script lang="ts">
  import type { ShieldLabsOptions } from '../../src/lib/index.js';
  import LegacyProvider from './LegacyProvider.svelte';
  import LegacyStatus from './LegacyStatus.svelte';

  interface Props {
    options: ShieldLabsOptions;
    userId?: string;
  }

  const { options, userId }: Props = $props();
</script>

<LegacyProvider {options}>
  <LegacyStatus {userId} />
</LegacyProvider>
