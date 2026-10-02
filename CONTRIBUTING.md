# Contributing to @shieldlabs-ai/svelte

Thank you for improving the ShieldLabs bindings for Svelte and SvelteKit.

## Set up

You need Node.js 20.19 or later (22.13 or later on the 22 line). Install the development tools and
the published `@shieldlabs-ai/js` peer dependency from this repository's root. You do not need a
checkout of another SDK.

```bash
npm ci
npm install --no-save --legacy-peer-deps=false '@shieldlabs-ai/js@^1.0.0'
```

Repeat the second command after every `npm ci`, which removes the separately installed peer.
`--no-save` leaves `package.json` and `package-lock.json` unchanged.

### Why there is an `.npmrc`

The lockfile was created with `legacy-peer-deps=true`; the repository keeps that setting for
`npm ci`. The separate install uses `--legacy-peer-deps=false` to resolve the published peer.
`save-dev=true` makes saved installs development dependencies by default; `--no-save` above avoids
saving anything. These settings apply only to this checkout: npm does not publish `.npmrc`.

CI still builds the loader from its `main` branch and tests the packed copy. The commands above
instead test the published 1.x loader. To test a loader change, build and pack it in its own
checkout, then replace the package name in the second command with the path to that tarball.
Never commit a `file:` dependency or a tarball.

## Checks

Run these before you open a pull request. CI runs them on Node.js 20, 22 and 24, runs the tests
with Svelte 5.0.0 too, and builds the SvelteKit example.

```bash
npm run check   # svelte-check, no errors or warnings
npm run lint    # ESLint for TypeScript and Svelte files
npm test        # Vitest with coverage: 90 % or more of src/lib
npm run build   # svelte-package and publint
```

The tests run in two Vitest projects: `dom` (jsdom, Svelte's browser runtime) and `ssr` (Node.js,
components rendered with `svelte/server`). `test/integration.test.ts` uses the real
`@shieldlabs-ai/js` loader and replaces only the hosted agent module that it imports from the CDN.

To try the example, see [examples/sveltekit/README.md](./examples/sveltekit/README.md). Delete its
`node_modules`, `.svelte-kit` and `build` folders afterwards.

## Guidelines

- The package stays a thin layer over `@shieldlabs-ai/js`: load the agent only through its `load()`,
  never import or bundle the agent yourself, and never touch `window` or `document` outside
  `onMount` and the calls a user makes.
- Never identify on render, in an effect or on navigation. Every identification is billable and
  counts against a small per-IP budget.
- The browser only receives request IDs: types never carry a Risk Score, risk signals or flags.
- Every change comes with tests. Use conventional commit messages (`feat:`, `fix:`, `docs:`,
  `test:`, `ci:`, `chore:`) and add a line to `CHANGELOG.md` under "Unreleased".
- Documentation style: plain technical English, "risk signals", and the three risk bands trusted
  0-29, suspicious 30-59 and dangerous 60-100.

## Releasing

Publish `@shieldlabs-ai/js` first. Then update the version in `package.json`, move the "Unreleased"
changelog entries under the new version, and push a tag such as `v1.0.1`. The release workflow has
two jobs:

- `build` runs all checks against the published `@shieldlabs-ai/js` and packs the package.
- `publish` runs in the `npm` environment and publishes that tarball with provenance, using the
  `NPM_TOKEN` secret. Add required reviewers to the environment in the repository settings to
  approve each release.

The workflow is safe to re-run: a version that is already on npm is not published again. If a
release requires a newer loader version, publish that version before re-running the workflow.

## Security

Please report security issues privately to <contact@shieldlabs.ai> rather than in a public issue.
