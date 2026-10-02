# @shieldlabs-ai/svelte

Svelte 5 and SvelteKit bindings for ShieldLabs: load the agent once for your app, read its state
from stores and get a request ID for every protected action.

[![CI](https://github.com/ShieldLabs-ai/shieldlabs-svelte/actions/workflows/ci.yml/badge.svg)](https://github.com/ShieldLabs-ai/shieldlabs-svelte/actions/workflows/ci.yml)
[![npm](https://img.shields.io/npm/v/@shieldlabs-ai/svelte)](https://www.npmjs.com/package/@shieldlabs-ai/svelte)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue)](./LICENSE)

`@shieldlabs-ai/svelte` is a thin layer over [`@shieldlabs-ai/js`](https://github.com/ShieldLabs-ai/shieldlabs-js),
the browser loader that imports the hosted ShieldLabs agent from `https://cdn.shieldlabs.ai`. It
adds a setup function for your root component, readable stores for the status of the agent and an
identify helper with loading and error state. It is safe in SvelteKit server-side rendering and
works in components with and without runes.

New to ShieldLabs? [Start free](https://app.shieldlabs.ai), then copy the Public Key of your domain
from Integration > API keys in the analytics dashboard (the Install tab also shows a ready snippet
that contains it).

## How it fits

1. **Browser.** `@shieldlabs-ai/svelte` loads the agent and runs an identification when your form is
   submitted. The page receives a `requestId`.
2. **Your backend.** It receives the `requestId` with the protected action (signup, login,
   checkout) and reads the verdict for it from the History API with a ShieldLabs server SDK, or
   receives it in a signed `identification.scored` webhook.
3. **Decision.** Your backend acts on the Risk Score (bands: trusted 0-29, suspicious 30-59,
   dangerous 60-100), the detection flags and identifiers such as the device ID.

The browser only ever gets the request ID. The Risk Score, risk signals, detection flags, visitor ID
and device ID are read on your server, so none of them appear in this package's types.

The `identification.scored` webhook is delivered once per identification today (1-second timeout,
no retries). Use the History API when your backend must have the verdict, and make webhook handlers
idempotent on `data.request_id`, because future retries will resend identical bytes.

## Install

```bash
npm install @shieldlabs-ai/svelte @shieldlabs-ai/js
```

`@shieldlabs-ai/js` is a peer dependency: install both packages (pnpm and yarn work the same way).
Your backend reads the verdicts with a [server SDK](#send-the-request-id-to-your-backend). The quick
start uses the one for Node.js:

```bash
npm install @shieldlabs-ai/node
```

## Quick start

A SvelteKit signup form. Add your Public Key and your Private API Key to `.env`:

```bash
PUBLIC_SHIELDLABS_PUBLIC_KEY=0123456789abcdef0123456789abcdef
SHIELDLABS_API_KEY=sec_your_private_key
```

```svelte
<!-- src/routes/+layout.svelte -->
<script lang="ts">
  import { PUBLIC_SHIELDLABS_PUBLIC_KEY } from '$env/static/public';
  import { setShieldLabs } from '@shieldlabs-ai/svelte';

  let { children } = $props();

  // Once for the whole app. The agent loads in the browser after hydration.
  setShieldLabs({ publicKey: PUBLIC_SHIELDLABS_PUBLIC_KEY });
</script>

{@render children()}
```

```svelte
<!-- src/routes/signup/+page.svelte -->
<script lang="ts">
  import { enhance } from '$app/forms';
  import { useIdentify } from '@shieldlabs-ai/svelte';
  import type { SubmitFunction } from '@sveltejs/kit';

  const { identify, isLoading } = useIdentify();

  const protect: SubmitFunction = async ({ formData }) => {
    const result = await identify(); // null when no identification was possible
    formData.set('requestId', result?.requestId ?? '');
  };
</script>

<form method="POST" use:enhance={protect}>
  <input name="email" type="email" required />
  <button disabled={$isLoading}>Sign up</button>
</form>
```

```ts
// src/routes/signup/+page.server.ts
import { fail } from '@sveltejs/kit';
import { SHIELDLABS_API_KEY } from '$env/static/private';
import { ShieldLabs, ValidationError, evaluateIdentification, type Identification } from '@shieldlabs-ai/node';
import type { Actions } from './$types';

const shieldlabs = new ShieldLabs({ apiKey: SHIELDLABS_API_KEY });
const usedRequestIds = new Set<string>(); // in production, your database

export const actions = {
  default: async ({ request }) => {
    const data = await request.formData();
    const requestId = String(data.get('requestId') ?? '');
    let identification: Identification | null = null;
    if (requestId) {
      try {
        // Waits until the identification is scored (about 1-3 seconds after identify()).
        identification = await shieldlabs.identifications.get(requestId);
      } catch (error) {
        if (!(error instanceof ValidationError)) throw error; // a malformed ID stays unverified
      }
    }
    const verdict = evaluateIdentification(identification, {
      isReplay: (id) => usedRequestIds.has(id), // request IDs that already authorized an action
    });
    if (!verdict.ok) return fail(403, { message: 'We could not verify this signup.' });
    usedRequestIds.add(requestId); // one identification authorizes one signup
    // ...create the account
  },
} satisfies Actions;
```

`use:enhance` sends the form with `fetch`, so the page stays alive while the agent posts the
identification (see [Keep the page alive](https://github.com/ShieldLabs-ai/shieldlabs-js#quick-start)).
Without JavaScript, or when the agent cannot load, the form is still sent without a `requestId`,
and your server treats the signup as unverified. A runnable version is in
[`examples/sveltekit`](./examples/sveltekit).

The History row that `identifications.get()` waits for appears about 1-3 seconds after `identify()`
resolves, and it can be refined for up to about 10 seconds as follow-up checks finish. To have the
verdict ready by the time the user submits, start the identification when the user begins the
action (see [Start when the user begins the action](#start-when-the-user-begins-the-action)).

> **Test on a registered domain.** ShieldLabs records identifications only for the domains
> registered in your account. On `localhost` the page still receives a `requestId`, but the
> identification is rejected with `401`, so your backend never finds it. Test on a development
> domain with its own keys, as described in [Environments](https://docs.shieldlabs.ai/setup/environments).

## Guide

### Set up once in the root component

Call `setShieldLabs()` during initialisation of the component at the root of your app: the root
`+layout.svelte` in SvelteKit, or `App.svelte` in a Svelte app built with Vite.

```svelte
<!-- App.svelte (Vite) -->
<script lang="ts">
  import { setShieldLabs } from '@shieldlabs-ai/svelte';
  import SignupForm from './SignupForm.svelte';

  setShieldLabs({ publicKey: import.meta.env.VITE_SHIELDLABS_PUBLIC_KEY });
</script>

<SignupForm />
```

The agent starts loading when that component mounts in the browser (with `autoLoad: false`, only
when you call `load()`, see [Wait for consent](#wait-for-consent)). Loading goes through the
memoized `load()` of `@shieldlabs-ai/js`, so the agent is imported once per page, however often a
component mounts. Client-side navigation does not load it again, and nothing in this package
identifies because of a re-render or a navigation: identifications run when you call `identify()`,
or once per mount with `runOnMount`. (The agent's own limited background checks are described under
[Call budget](https://github.com/ShieldLabs-ai/shieldlabs-js#call-budget).)

The options are read once. To use props such as `data` without Svelte's "only captures the initial
value" warning, pass a function that returns the options:

```ts
setShieldLabs(() => ({ publicKey: PUBLIC_SHIELDLABS_PUBLIC_KEY, checkOnLoad: { userId: data.userHid } }));
```

### Show the agent status

`getShieldLabs()` returns the status, the calls and the agent of the nearest `setShieldLabs()` above
the component. `setShieldLabs()` returns the same object.

```svelte
<script lang="ts">
  import { getShieldLabs } from '@shieldlabs-ai/svelte';

  const { status, error } = getShieldLabs();
</script>

{#if $status === 'error'}
  <p>Protection unavailable ({$error?.code}). You can still sign up.</p>
{/if}
```

`status` is `'loading'` until the agent is loaded (also during server-side rendering, and with
`autoLoad: false` until `load()`), then `'ready'`, or `'error'` with the reason in `error`. When
loading failed, the next `identify()`, `check()`, `getAgent()` or `load()` tries again and `status`
follows. After a `timeout` the import keeps running: when the agent arrives, `status` becomes
`'ready'` (and `checkOnLoad` runs) without another request. The calls, `getAgent()` and `runOnMount`
identifications that waited for that load have ended with its `timeout`, and none of them runs
again by itself.

A setup that loading again cannot fix also logs one console warning that starts with
`[ShieldLabs]`: invalid options (for example a `publicKey` from an environment variable that is not
set) or a page that is not a secure context (plain `http` on an address other than `localhost` and
`127.0.0.1`). Blocked downloads and timeouts stay quiet, because they are normal for some visitors.

### Protect a form

`useIdentify()` gives each form its own helper: `identify()` runs a fresh identification and
resolves `{ requestId, userId }`, or `null` when no identification was possible (the reason is in
`$error`). It never rejects, so a submit handler needs no `try`/`catch`:

```svelte
<script lang="ts">
  import { useIdentify } from '@shieldlabs-ai/svelte';

  const { identify, isLoading, error } = useIdentify();

  async function onsubmit(event: SubmitEvent) {
    event.preventDefault();
    const form = event.currentTarget as HTMLFormElement;
    const result = await identify();
    await fetch('/api/signup', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: form.email.value, requestId: result?.requestId ?? null }),
    });
  }
</script>

<form {onsubmit}>
  <input name="email" type="email" required />
  <button disabled={$isLoading}>Sign up</button>
</form>
```

- Every call starts a new identification with a new request ID. Call it once per submission, never
  on render or in an effect.
- A call of the same helper while an identification with the same User HID and the same timeout
  runs returns that one, also when other identifications started in between, so a double submit
  does not spend two identifications; the stores follow the identification it returns. A call
  without its own `timeout` counts with the `useIdentify()` `timeout`, else the setup `timeout`
  (10000 ms by default), so with the defaults `identify()` and `identify({ timeout: 10000 })` share
  one identification.
- `$isLoading` is `true` from the call until the result is in, including the wait for the agent.
  `$result` holds the latest result. `reset()` clears `$result` and `$error`.
- The `timeout` (from the call, else from the `useIdentify()` options, else the setup `timeout`)
  covers the whole call: the wait for the agent to load and the agent's answer. When the call had
  to wait for the agent, the agent gets the time that is left. A load that fails or times out
  first (the setup `timeout` limits the load) ends the call with that error.

### Start when the user begins the action

`identify()` on submit, as above, is enough for most forms. To have the identification finished by
the time the user submits, for example before a classic full-page form post, start it on the first
interaction with the form: `getAgent()` resolves the agent of `@shieldlabs-ai/js`, and
`agent.identifyOnInteraction(form)` starts `identify()` on the first focus, pointer or key event
inside the form.

```svelte
<!-- src/routes/signup/+page.svelte: a full-page form post, without use:enhance -->
<script lang="ts">
  import { onMount } from 'svelte';
  import { getShieldLabs, type InteractionIdentifier } from '@shieldlabs-ai/svelte';

  const { getAgent } = getShieldLabs();
  let form: HTMLFormElement;
  let requestIdField: HTMLInputElement;
  let early: InteractionIdentifier | undefined;

  onMount(() => {
    let active = true;
    // Arms the form once the agent is loaded. The submit handler never waits for this.
    getAgent().then(
      (agent) => {
        if (active) early = agent.identifyOnInteraction(form);
      },
      () => {}, // no agent: the form is sent without a requestId
    );
    return () => {
      active = false;
      early?.dispose();
    };
  });

  async function onsubmit(event: SubmitEvent) {
    event.preventDefault();
    try {
      // The early identification while it is fresh, otherwise a new one.
      if (early) requestIdField.value = (await early.take()).requestId;
    } catch {
      // No identification: the form is sent without a requestId, and your server treats it as unverified.
    }
    form.submit();
  }
</script>

<form bind:this={form} method="POST" {onsubmit}>
  <input name="email" type="email" required />
  <input bind:this={requestIdField} type="hidden" name="requestId" />
  <button>Sign up</button>
</form>
```

`getAgent()` has no timeout of its own: it resolves once the agent has loaded (with
`autoLoad: false`, after `load()`), and rejects with the error of a load that fails or times out
(the setup `timeout`). That is why the submit handler does not wait for it: a submission before the
agent has loaded goes out at once, without a `requestId`.

`take()` returns the identification for this submission and re-arms the handle, so the next
submission gets its own request ID. It hands out the early identification only while it is fresh:
when it failed, or finished more than four minutes ago, `take()` starts a new one (replacing a stale
one costs one more identification). With `use:enhance`, call `take()` in the submit function the same
way and put the request ID in `formData`. If users can submit without interacting with the form
first (autofill and a single click), prefer `use:enhance`, which keeps the page alive while the
agent posts the identification. Details:
[Protect a form](https://github.com/ShieldLabs-ai/shieldlabs-js#protect-a-form). A runnable
version is in [`examples/sveltekit`](./examples/sveltekit).

### Send the request ID to your backend

Your server reads the verdict for the `requestId` with a ShieldLabs server SDK, which waits until
the identification has been scored:
[Node.js](https://github.com/ShieldLabs-ai/shieldlabs-node),
[Python](https://github.com/ShieldLabs-ai/shieldlabs-python),
[Go](https://github.com/ShieldLabs-ai/shieldlabs-go),
[PHP](https://github.com/ShieldLabs-ai/shieldlabs-php),
[Java](https://github.com/ShieldLabs-ai/shieldlabs-java) and
[.NET](https://github.com/ShieldLabs-ai/shieldlabs-dotnet). In SvelteKit that happens in a form
action or a `+server.ts` endpoint, as in the quick start.

- One identification authorizes one protected action: accept each request ID once, and only within
  your freshness window (5 minutes in the examples).
- A missing `requestId` or identification means "unverified" (for example step-up or review),
  never "clean".
- Keep the Private API Key (`sec_...`) in server-only code such as `$env/static/private`. Only the
  Public Key belongs in the browser.

### Signed-in users: pass a User HID

Pass a User HID so ShieldLabs ties the identification to the account. Compute it on your server,
for example in `+layout.server.ts` with `userHid()` of `@shieldlabs-ai/node` (HMAC-SHA256 of your
account ID with a secret key), and hand it to the page through `data`:

```ts
// src/routes/+layout.server.ts
import { USER_HID_SECRET } from '$env/static/private';
import { userHid } from '@shieldlabs-ai/node';
import type { LayoutServerLoad } from './$types';

export const load: LayoutServerLoad = ({ locals }) => ({
  // locals.user: the signed-in account, set in hooks.server.ts and declared in src/app.d.ts
  userHid: locals.user ? userHid(String(locals.user.id), USER_HID_SECRET) : undefined,
});
```

`USER_HID_SECRET` is a long random value of your own, kept on the server. `locals.user` needs a
declaration in `App.Locals`, for example:

```ts
// src/app.d.ts
declare global {
  namespace App {
    interface Locals {
      user?: { id: string | number };
    }
  }
}

export {};
```

```svelte
<script lang="ts">
  import { useIdentify } from '@shieldlabs-ai/svelte';

  let { data } = $props();

  // A function is read when each identification starts, so it follows sign-in and sign-out.
  const { identify } = useIdentify(() => ({ userId: data.userHid }));
</script>
```

You can also pass options per call: `identify({ userId })`. A `userId` key overrides the helper's User
HID for that call even when its value is `undefined` or `null`, which both mean anonymous; only a call
without the key uses the helper's User HID. Never pass a raw email address, phone
number or database ID. `@shieldlabs-ai/js` refuses the reserved values `"anonymous"`, `"fail"`, `"-1"`
and `"unknown"`. Omit `userId` for visitors who are not signed in.

### Identify when a page opens

`runOnMount: true` runs one identification as soon as the agent is ready after the component
mounts, for pages where the protected action is opening the page itself. Read the result from
`$result`. Every identification is billable, so use it sparingly.

```ts
const { result } = useIdentify({ runOnMount: true });
```

It does not run again on re-render or on client-side navigation to the same page component. It is
skipped when the component is gone before the agent is ready. When the load fails or times out, or
the agent is not ready within the `timeout` of the identification (the helper's `timeout`, else the
setup `timeout`), it ends with that error in `$error`, and it does not run when the agent arrives
later: call `identify()` for another attempt. With `autoLoad: false`, call `load()` before the
component mounts, during initialisation of the root component (see
[Wait for consent](#wait-for-consent)): an identification that starts before `load()` resolves
`null` at once with `not_initialized`, like `identify()`, and does not run again by itself after
`load()`.

### Background checks

`checkOnLoad` runs the agent's limited background check once when the agent is ready, for passive
monitoring of the visit. `true` checks anonymously, `{ userId }` for a signed-in user.

```ts
setShieldLabs({ publicKey: PUBLIC_SHIELDLABS_PUBLIC_KEY, checkOnLoad: true });
```

The agent runs such checks at most once per visit every five minutes, and a check the agent skips is
not an error. When an identification or check for the same User HID is already running as the
agent becomes ready (for example `runOnMount`, or a submit that waits for the agent), `checkOnLoad`
does not run: that call identifies the visit already. `getShieldLabs().check()` runs the same check
on demand and resolves `null` when it was skipped.

### Wait for consent

Where your policy requires consent before the agent runs, pass `autoLoad: false` and call `load()`
once consent is given. Until then nothing loads, and `status` stays `'loading'`:

```svelte
<!-- src/routes/+layout.svelte -->
<script lang="ts">
  import { PUBLIC_SHIELDLABS_PUBLIC_KEY } from '$env/static/public';
  import { setShieldLabs } from '@shieldlabs-ai/svelte';
  import { consent } from '$lib/consent'; // your consent state, for example a store your banner sets

  let { children } = $props();

  const { load } = setShieldLabs({ publicKey: PUBLIC_SHIELDLABS_PUBLIC_KEY, autoLoad: false });

  // Consent from an earlier visit: load during initialisation, before the page mounts.
  if ($consent) load();
  // Consent given on this page: load once the banner sets it.
  $effect(() => {
    if ($consent) load();
  });
</script>

{@render children()}
```

`load()` does nothing while the agent loads or once it is loaded, and nothing during server-side
rendering, so it is safe to call during initialisation, as above. It returns nothing: `status` and
`error` report the load. An `$effect` runs only after the page has mounted: when consent is already
known as the app starts (from your consent storage or a cookie), call `load()` during initialisation
as well, so that `runOnMount` identifications of the page wait for the agent.

Until `load()` is called, nothing waits for consent:

- `identify()` of `useIdentify()` resolves `null` at once, with a `not_initialized` error, so the
  form is sent without a `requestId` and your server treats it as unverified. Submit handlers like
  the one in the [quick start](#quick-start) need no consent check of their own.
- `getShieldLabs().identify()` rejects with `not_initialized` at once, and `check()` resolves
  `null`.
- `getAgent()` waits for `load()` and then for the agent, with no timeout of its own, so a form set
  up as in [Start when the user begins the action](#start-when-the-user-begins-the-action) is armed
  once the agent has loaded.
- A `runOnMount` identification that starts before `load()` ends like `identify()` of
  `useIdentify()`: it resolves `null` at once with `not_initialized`, and it does not run again by
  itself after `load()`. `checkOnLoad` runs once the agent is ready.

### Components with and without runes

The state comes as `svelte/store` readables, so `$status`, `$result` and the other stores work in
the markup and the script of runes components and of components that use `export let`. Outside
components, for example in `.svelte.ts` modules, wrap a store with `fromStore()` from
`svelte/store` to read it as `.current`.

### Server-side rendering

Nothing runs during server-side rendering: the agent loads in `onMount`, which runs only in the
browser, so no code touches `window` or `document` on the server. The stores render their initial
values (`status` is `'loading'`), which also makes the package safe for prerendered pages. `load()`
does nothing on the server. A call to `identify()`, `check()` or `getAgent()` on the server rejects
(or, for `useIdentify()`, resolves `null`) with `unsupported_environment` at once, also with
`autoLoad: false`, and logs one console warning.

### Call budget, Content Security Policy and consent

These are the same as for [`@shieldlabs-ai/js`](https://github.com/ShieldLabs-ai/shieldlabs-js):

- [Call budget](https://github.com/ShieldLabs-ai/shieldlabs-js#call-budget): identify once per
  protected action, never on every render or route change, and never clear the agent's storage.
- [Content Security Policy](https://github.com/ShieldLabs-ai/shieldlabs-js#content-security-policy):
  the `script-src` and `connect-src` origins the agent needs. In SvelteKit, set them in `kit.csp`.
- [Consent](https://github.com/ShieldLabs-ai/shieldlabs-js#consent): the agent does not read your
  consent banner. Where consent is required, load the agent only after consent, as in
  [Wait for consent](#wait-for-consent).

## Reference

| Export | Description |
|---|---|
| `setShieldLabs(options)` | Sets up ShieldLabs for the component and its children and returns the context. Call during component initialisation. `options` is a `ShieldLabsOptions` object or a function that returns one |
| `getShieldLabs()` | The context of the nearest `setShieldLabs()`: `{ status, error, identify, check, load, getAgent }`. Call during component initialisation |
| `useIdentify(options?)` | An identify helper: `{ result, isLoading, error, identify, reset }`. `options` is a `UseIdentifyOptions` object or a function that returns one. Call during component initialisation |
| `ShieldLabsError` | The error class of `@shieldlabs-ai/js`, re-exported. Has `code` and optional `cause` |
| Types | `ShieldLabsOptions`, `CheckOnLoadOptions`, `ShieldLabsContext`, `ShieldLabsStatus`, `UseIdentifyOptions`, `IdentifyHelper`, and from `@shieldlabs-ai/js`: `IdentifyOptions`, `IdentifyResult`, `LoadOptions`, `ShieldLabsAgent`, `InteractionIdentifier`, `ShieldLabsErrorCode` |

`ShieldLabsOptions` (the `@shieldlabs-ai/js` load options plus `checkOnLoad` and `autoLoad`)

| Option | Type | Default | Description |
|---|---|---|---|
| `publicKey` | `string` | required | Public Key of your domain |
| `environment` | `'production' \| 'development'` | `'production'` | Which ShieldLabs CDN to load the agent from |
| `scriptUrl` | `string` | | Advanced: agent module URL override (`https`, or `http` on `localhost` and `127.0.0.1`) |
| `timeout` | `number` | `10000` | Milliseconds to wait for the agent to load, and the time a call without its own `timeout` may take in all |
| `checkOnLoad` | `boolean \| { userId?: string }` | `false` | Run one background check when the agent is ready, unless a call for the same User HID is running |
| `autoLoad` | `boolean` | `true` | Load the agent when the component mounts. With `false` (or any value other than `true`), nothing loads until `load()`: until then `identify()` fails at once with `not_initialized` (`useIdentify().identify()` and a `runOnMount` identification resolve `null`), `check()` resolves `null`, and `getAgent()` waits for `load()` |

`ShieldLabsContext`

| Member | Type | Description |
|---|---|---|
| `status` | `Readable<'loading' \| 'ready' \| 'error'>` | State of the agent |
| `error` | `Readable<ShieldLabsError \| null>` | Why loading failed, otherwise `null` |
| `identify(options?)` | `Promise<IdentifyResult>` | Waits for the agent, then runs a fresh identification. The `timeout` covers the whole call. Rejects with a `ShieldLabsError`: with `autoLoad: false` before `load()`, at once with `not_initialized` |
| `check(options?)` | `Promise<IdentifyResult \| null>` | Waits for the agent, then runs the limited background check. The `timeout` covers the whole call. `null` when the agent skipped it, and at once with `autoLoad: false` before `load()` |
| `load()` | `void` | Starts loading the agent: needed with `autoLoad: false`, and tries again after a failed load. Does nothing while the agent loads, once it is loaded, and during server-side rendering. Returns nothing: `status` and `error` report the load |
| `getAgent()` | `Promise<ShieldLabsAgent>` | The agent of `@shieldlabs-ai/js` once it is loaded, for example for `agent.identifyOnInteraction(form)`. Loads it like a call does (with `autoLoad: false`, waits for `load()`). No timeout of its own. Rejects with the error of a load that failed or timed out (the setup `timeout`) |

`UseIdentifyOptions`

| Option | Type | Default | Description |
|---|---|---|---|
| `userId` | `string` | | User HID computed on your server. Omit for anonymous identifications |
| `timeout` | `number` | the setup `timeout` | Milliseconds for the whole call: the wait for the agent to load plus its answer |
| `runOnMount` | `boolean` | `false` | Identify once as soon as the agent is ready after mount. After a load error or load timeout it ends with that error and does not run when the agent arrives later. With `autoLoad: false`, call `load()` before the mount: a run that starts before `load()` resolves `null` with `not_initialized` and does not run again |

`IdentifyHelper`

| Member | Type | Description |
|---|---|---|
| `result` | `Readable<IdentifyResult \| null>` | The latest identification, `null` before the first one, while one runs and after an error |
| `isLoading` | `Readable<boolean>` | `true` while an identification of this helper runs |
| `error` | `Readable<ShieldLabsError \| null>` | Why the latest identification failed, otherwise `null` |
| `identify(options?)` | `Promise<IdentifyResult \| null>` | Runs a fresh identification. Options override the helper options; a `userId` key overrides the User HID even when it is `undefined` or `null` (anonymous). Returns a running one of this helper for the same User HID and timeout (without a `timeout`, the `useIdentify()` one, else the setup `timeout`), and the stores follow it. `null` at once, with a `not_initialized` error, with `autoLoad: false` before `load()`. Never rejects |
| `reset()` | `void` | Clears `result` and `error`; a running identification no longer updates the stores |

`IdentifyResult` is `{ requestId: string; userId: string | null }`. `ShieldLabsAgent` and
`InteractionIdentifier` are described in the
[`@shieldlabs-ai/js` reference](https://github.com/ShieldLabs-ai/shieldlabs-js#reference).

## Errors and retries

Every error is a `ShieldLabsError` with a `code`, passed through from `@shieldlabs-ai/js`:

| Where | How it shows |
|---|---|
| Loading the agent | `status` becomes `'error'` and `error` holds the reason: `invalid_options` (for example a wrong Public Key), `unsupported_environment` (not a secure context), `load_failed` (network, content blocker, Content Security Policy) or `timeout`. The first two also log one console warning |
| `useIdentify().identify()` | Resolves `null`, and the helper's `error` store holds the reason, for example `not_initialized` or `timeout` |
| `getShieldLabs().identify()` and `check()` | Reject with the reason. `check()` resolves `null` when the agent skipped the check, and before `load()` with `autoLoad: false` |
| `getShieldLabs().getAgent()` | Rejects with the error of a load that failed or timed out (`timeout`), also when the agent arrives later |

Nothing is retried automatically, because every identification counts against the call budget. A
failed load is tried again by the next `identify()`, `check()`, `getAgent()` or `load()`. A load
error or a load `timeout` ends everything that waited for that load with the error: calls (also
those whose own `timeout` has time left), `getAgent()` and a `runOnMount` identification. After a
load `timeout` the import keeps running, and `status` becomes `'ready'` when the agent arrives, but
nothing that ended runs again: the next call gets the agent. For `not_initialized` (another
identification is running in this or another tab, or `load()` has not been called with
`autoLoad: false`), retry once later or send the action without a `requestId`. The full list of
codes is in [Errors](https://github.com/ShieldLabs-ai/shieldlabs-js#errors).

## Compatibility

- Svelte 5.0 and later, in components with runes and in components without them. SvelteKit 2 with
  any adapter, including prerendering and server-side rendering.
- `@shieldlabs-ai/js` 1.x as a peer dependency.
- Browsers: those supported by `@shieldlabs-ai/js` (ES modules, dynamic `import()` and WebCrypto). The
  page must be a secure context: HTTPS, or `http://localhost` and `http://127.0.0.1` during
  development.
- Output: ES modules with TypeScript declarations, built with `svelte-package`. No runtime
  dependencies besides the peers.

## Development

From the repository root, install the development tools and the published loader. No sibling
repository is required. Repeat the loader install after each `npm ci`.

```bash
npm ci
npm install --no-save --legacy-peer-deps=false '@shieldlabs-ai/js@^1.0.0'
npm run check   # svelte-check
npm run lint
npm test        # with coverage (90 % or more)
npm run build   # svelte-package and publint
```

See [CONTRIBUTING.md](./CONTRIBUTING.md). Documentation: <https://docs.shieldlabs.ai>. Analytics
dashboard: <https://app.shieldlabs.ai>. Support: <contact@shieldlabs.ai>.

## License

[MIT](./LICENSE), Copyright (c) 2026 ShieldLabs Inc.
