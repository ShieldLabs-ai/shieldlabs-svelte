<script lang="ts">
  import { untrack } from 'svelte';
  import { useIdentify, type IdentifyHelper, type UseIdentifyOptions } from '../../src/lib/index.js';

  interface Props {
    options?: UseIdentifyOptions;
    onsetup?: (helper: IdentifyHelper) => void;
    label?: string;
  }

  const { options, onsetup, label = 'Sign up' }: Props = $props();
  // Read when an identification starts, so a changed `options` prop is used.
  const helper = useIdentify(() => options);
  untrack(() => onsetup?.(helper));
  const { result, isLoading, error, identify } = helper;
</script>

<button type="button" disabled={$isLoading} onclick={() => identify()}>{label}</button>
<p data-testid="loading">{$isLoading ? 'yes' : 'no'}</p>
<p data-testid="request-id">{$result?.requestId ?? ''}</p>
<p data-testid="user-id">{$result?.userId ?? ''}</p>
<p data-testid="identify-error">{$error?.code ?? ''}</p>
