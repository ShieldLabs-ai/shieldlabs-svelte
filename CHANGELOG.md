# Changelog

All notable changes to `@shieldlabs-ai/svelte` are documented in this file. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the package uses
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [1.0.0] - 2026-09-30

### Added

- `setShieldLabs(options)`: sets up ShieldLabs for a component and its children through the Svelte
  component context, for the root component or the root `+layout.svelte`. The agent loads on mount
  in the browser, never during server-side rendering, through the memoized `load()` of
  `@shieldlabs-ai/js`, so mounting twice imports the agent once. Accepts the options object or a
  function that returns it. A setup that cannot load the agent because of invalid options or a page
  that is not a secure context logs one console warning.
- `autoLoad` option (default `true`): with `false`, nothing loads until `load()` is called, for
  example after consent. Until then nothing waits for it: `identify()` fails at once with
  `not_initialized` (`useIdentify().identify()` resolves `null`, and so does a `runOnMount`
  identification, which does not run again after `load()`), `check()` resolves `null`, and
  `getAgent()` waits for `load()`.
- `getShieldLabs()`: the status of the agent as `svelte/store` readables (`status`: `loading`,
  `ready` or `error`, and `error`), plus `identify()` and `check()`, which wait for the agent and
  retry a failed load, `load()`, which starts loading, returns nothing and does nothing on the
  server, and `getAgent()`, which resolves the agent of `@shieldlabs-ai/js`, for example for
  `agent.identifyOnInteraction(form)` before a full-page form post. `getAgent()` has no timeout of
  its own and rejects with the error of a load that fails or times out. After a load timeout the
  setup still waits for the running import, so an agent that arrives late makes `status` `ready`
  and runs `checkOnLoad`; nothing that waited for the load runs again.
- One timeout per call: the `timeout` of the call, or the setup `timeout` when it has none, covers
  the wait for the agent to load and the agent's answer. A call that waited gets the time left for
  the agent. A load that fails or times out ends the calls that wait for it with that error.
- `useIdentify(options?)`: an identify helper with `result`, `isLoading` and `error` stores,
  `identify()` (resolves `null` instead of rejecting, with the reason in `error`) and `reset()`. A
  call of the same helper with the same User HID and timeout as a running identification shares it,
  also when other identifications started in between, and the stores follow it, so a double submit
  costs one identification; a call without a timeout counts with the one it runs with (the
  `useIdentify()` timeout, else the setup timeout). Options can be a function
  that is read when each identification starts. Options that are not an object reach
  `@shieldlabs-ai/js`, which rejects them with `invalid_options`.
- `runOnMount`: one identification as soon as the agent is ready after mount; skipped when the
  component is gone first. After a load error or load timeout it ends with that error and does not
  run when the agent arrives later. With `autoLoad: false` before `load()` it resolves `null` with
  `not_initialized`, like `identify()`, and does not run again after `load()`.
- `checkOnLoad`: one background check when the agent is ready (`true` or `{ userId }`), unless an
  identification or check for the same User HID is running at that moment.
- Works in components with and without runes, and in SvelteKit server-side rendering and
  prerendering. `ShieldLabsError` and the `@shieldlabs-ai/js` types, including `ShieldLabsAgent` and
  `InteractionIdentifier`, are re-exported.
- `examples/sveltekit`: a signup form with `use:enhance` and a form action, and a full-page form
  post that starts the identification on the first interaction with the form.

[Unreleased]: https://github.com/ShieldLabs-ai/shieldlabs-svelte/compare/v1.0.0...HEAD
[1.0.0]: https://github.com/ShieldLabs-ai/shieldlabs-svelte/releases/tag/v1.0.0
