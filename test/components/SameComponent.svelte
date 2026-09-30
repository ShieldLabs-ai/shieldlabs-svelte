<script lang="ts">
  import { untrack } from 'svelte';
  import { getShieldLabs, setShieldLabs, useIdentify, type ShieldLabsOptions } from '../../src/lib/index.js';

  interface Props {
    options: ShieldLabsOptions;
    /** Calls load() during initialisation, before the component mounts. */
    loadEarly?: boolean;
  }

  const { options, loadEarly = false }: Props = $props();
  const created = setShieldLabs(() => options);
  const found = getShieldLabs();
  const { result } = useIdentify({ runOnMount: true });
  const { status } = found;
  if (untrack(() => loadEarly)) created.load();
</script>

<p data-testid="same">{created === found ? 'same' : 'different'}</p>
<p data-testid="status">{$status}</p>
<p data-testid="request-id">{$result?.requestId ?? ''}</p>
