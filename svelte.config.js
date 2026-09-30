import { vitePreprocess } from '@sveltejs/vite-plugin-svelte';

/** Used by svelte-package, svelte-check and the Svelte plugin in the tests. */
export default {
  // `script: true` strips TypeScript before the Svelte compiler runs, so the test components also
  // compile with the oldest Svelte 5 releases that the peer dependency range allows.
  preprocess: vitePreprocess({ script: true }),
};
