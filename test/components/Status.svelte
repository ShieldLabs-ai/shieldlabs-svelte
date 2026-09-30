<script lang="ts">
  import { untrack } from 'svelte';
  import { getShieldLabs, type ShieldLabsContext } from '../../src/lib/index.js';

  interface Props {
    onsetup?: (context: ShieldLabsContext) => void;
  }

  const { onsetup }: Props = $props();
  const shieldlabs = getShieldLabs();
  untrack(() => onsetup?.(shieldlabs));
  const { status, error } = shieldlabs;
</script>

<p data-testid="status">{$status}</p>
<p data-testid="error">{$error ? `${$error.code}: ${$error.message}` : ''}</p>
