<script lang="ts">
  // Legacy (non-runes) mode with the plain options object form of setShieldLabs().
  import { setShieldLabs, type ShieldLabsOptions } from '../../src/lib/index.js';

  export let options: ShieldLabsOptions;

  const { status } = setShieldLabs(options);
</script>

<p data-testid="legacy-root-status">{$status}</p>
<slot />
