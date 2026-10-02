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

From this example directory, install the published packages from npm:

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

Use the published loader and a tarball of this checkout to test changes to the Svelte binding:

```bash
# in the root of this repository
npm ci
npm install --no-save --legacy-peer-deps=false '@shieldlabs-ai/js@^1.0.0'
npm run build && npm pack

cd examples/sveltekit
npm install --no-save --no-package-lock ../../shieldlabs-ai-svelte-1.0.0.tgz
PUBLIC_SHIELDLABS_PUBLIC_KEY=0123456789abcdef0123456789abcdef npm run check
PUBLIC_SHIELDLABS_PUBLIC_KEY=0123456789abcdef0123456789abcdef npm run build
```

Both commands need the Public Key because SvelteKit generates `$env/static/public` types from the
environment. The placeholder above is for compilation only; use your registered domain's key to
run identifications. Running the check first also generates SvelteKit's configuration for the build.

Adjust the tarball filename if the package version changes. To test a loader change as well,
build and pack it in its own checkout and pass that tarball to both install commands in place of
the published loader (include it in the example install too). Never commit a tarball or a `file:`
dependency.
