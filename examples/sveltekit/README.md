# SvelteKit example

A minimal SvelteKit app with two versions of a signup form:

- `src/routes/+layout.svelte` calls `setShieldLabs()` once for the whole app and shows the agent
  status. The agent loads in the browser after hydration, never during server-side rendering.
- `src/routes/+page.svelte` sends the form with `use:enhance` and adds the `requestId` of a fresh
  identification from `useIdentify()` to every submission. Without JavaScript, or when no
  identification is available, the form is still sent, without a `requestId`.
- `src/routes/full-page-post/+page.svelte` sends the form as a classic full-page post. It gets the
  agent with `getShieldLabs().getAgent()` and starts the identification with
  `agent.identifyOnInteraction(form)` on the first interaction with the form, so that it has
  finished before the page navigates away. The submit handler puts the request ID in a hidden
  field, and never waits for the agent: before it has loaded, the form is sent without one.
- `src/lib/server/signup.ts` is the form action of both pages. It shows where your server reads the
  verdict for the `requestId` with a ShieldLabs server SDK before it creates the account.

## Run it

```bash
npm install
cp .env.example .env   # then set PUBLIC_SHIELDLABS_PUBLIC_KEY
npm run dev
```

Open the URL Vite prints (for example <http://localhost:5173>) and submit the form, or switch to the
full-page form post in the navigation. The page shows the request ID that the form action received.

ShieldLabs accepts identifications only from registered domains. On `localhost` the request ID
still reaches the page, but no identification is recorded. Serve the example from a registered
development domain to see results in the [analytics dashboard](https://app.shieldlabs.ai).

## Build against local copies of the packages

Before `@shieldlabs/svelte` and `@shieldlabs/js` are on npm, build both and install the packed
files instead of `npm install`:

```bash
# in the shieldlabs-js repository
npm ci && npm run build && npm pack

# in the root of this repository
npm run build && npm pack

cd examples/sveltekit
npm install --no-save --no-package-lock ../../shieldlabs-svelte-1.0.0.tgz ../../../shieldlabs-js/shieldlabs-js-1.0.0.tgz
PUBLIC_SHIELDLABS_PUBLIC_KEY=0123456789abcdef0123456789abcdef npm run build
npm run check
```
