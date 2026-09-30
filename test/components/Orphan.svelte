<script lang="ts">
  import { untrack } from 'svelte';
  import { getShieldLabs, useIdentify } from '../../src/lib/index.js';

  interface Props {
    use: 'getShieldLabs' | 'useIdentify';
  }

  const { use }: Props = $props();
  if (untrack(() => use) === 'getShieldLabs') getShieldLabs();
  else useIdentify();
</script>

<p>unreachable</p>
