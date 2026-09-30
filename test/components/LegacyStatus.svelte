<script lang="ts">
  // A component in legacy (non-runes) mode: `export let` props and `$:` statements.
  import { getShieldLabs, useIdentify } from '../../src/lib/index.js';

  export let userId: string | undefined = undefined;

  const { status } = getShieldLabs();
  const { result, isLoading, identify } = useIdentify({ userId });

  $: summary = `${$status} ${$isLoading ? 'busy' : 'idle'}`;
</script>

<p data-testid="legacy-summary">{summary}</p>
<p data-testid="legacy-request-id">{$result ? $result.requestId : ''}</p>
<button type="button" on:click={() => identify()}>Legacy identify</button>
