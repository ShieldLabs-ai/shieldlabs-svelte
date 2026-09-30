<script lang="ts">
  import { untrack, type Snippet } from 'svelte';
  import { setShieldLabs, type ShieldLabsContext, type ShieldLabsOptions } from '../../src/lib/index.js';

  interface Props {
    options: ShieldLabsOptions;
    onsetup?: (context: ShieldLabsContext) => void;
    children?: Snippet;
  }

  const { options, onsetup, children }: Props = $props();
  // The getter form reads the props once, without Svelte's initial-value warning.
  const shieldlabs = setShieldLabs(() => options);
  untrack(() => onsetup?.(shieldlabs));
  const { status, error } = shieldlabs;
</script>

<p data-testid="root-status">{$status}</p>
<p data-testid="root-error">{$error?.code ?? ''}</p>
{@render children?.()}
