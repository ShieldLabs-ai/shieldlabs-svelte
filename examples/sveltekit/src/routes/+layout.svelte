<script lang="ts">
  import { PUBLIC_SHIELDLABS_PUBLIC_KEY } from '$env/static/public';
  import { setShieldLabs } from '@shieldlabs-ai/svelte';
  import type { LayoutProps } from './$types';

  const { children }: LayoutProps = $props();

  // One setup for the whole app. The agent loads in the browser after hydration, never during
  // server-side rendering, and client-side navigation does not load it again.
  const { status } = setShieldLabs({ publicKey: PUBLIC_SHIELDLABS_PUBLIC_KEY });
</script>

<nav>
  <a href="/">Signup with use:enhance</a>
  <a href="/full-page-post">Signup with a full-page form post</a>
</nav>

<main>
  {@render children()}
</main>

<footer>
  <small>ShieldLabs agent: {$status}</small>
</footer>

<style>
  :global(body) {
    font-family: system-ui, sans-serif;
    max-width: 28rem;
    margin: 3rem auto;
    padding: 0 1rem;
  }

  :global(label) {
    display: block;
    margin: 0 0 1rem;
  }

  :global(input) {
    display: block;
    width: 100%;
    padding: 0.5rem;
    margin-top: 0.25rem;
    box-sizing: border-box;
  }

  nav {
    display: flex;
    gap: 1rem;
    margin-bottom: 2rem;
  }

  footer {
    margin-top: 2rem;
    color: #555;
  }
</style>
