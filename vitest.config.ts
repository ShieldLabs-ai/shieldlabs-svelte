import { svelte } from '@sveltejs/vite-plugin-svelte';
import { svelteTesting } from '@testing-library/svelte/vite';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Every test starts with empty call records, so that the tests pass in any order.
    clearMocks: true,
    restoreMocks: true,
    unstubGlobals: true,
    server: {
      deps: {
        // Process @shieldlabs/js with Vite so that test/integration.test.ts can replace the
        // hosted agent module that the loader imports from the CDN at runtime.
        inline: ['@shieldlabs/js'],
      },
    },
    projects: [
      {
        // Browser tests: jsdom on an HTTPS page, Svelte's browser runtime.
        extends: true,
        plugins: [svelte(), svelteTesting()],
        test: {
          name: 'dom',
          environment: 'jsdom',
          environmentOptions: {
            jsdom: { url: 'https://shop.example.com/signup' },
          },
          include: ['test/**/*.test.ts'],
          exclude: ['test/ssr.test.ts'],
        },
      },
      {
        // Server-side rendering: no window or document, Svelte's server runtime (as in SvelteKit).
        extends: true,
        plugins: [svelte(), svelteTesting({ resolveBrowser: false, autoCleanup: false })],
        test: {
          name: 'ssr',
          environment: 'node',
          include: ['test/ssr.test.ts'],
        },
      },
    ],
    coverage: {
      provider: 'v8',
      include: ['src/lib/**/*.ts'],
      reporter: ['text', 'json-summary'],
      thresholds: {
        lines: 90,
        statements: 90,
        functions: 90,
        branches: 90,
      },
    },
  },
});
