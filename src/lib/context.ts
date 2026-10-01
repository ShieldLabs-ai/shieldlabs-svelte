import {
  load,
  ShieldLabsError,
  type IdentifyOptions,
  type IdentifyResult,
  type LoadOptions,
  type ShieldLabsAgent,
} from '@shieldlabs-ai/js';
import { getContext, onMount, setContext } from 'svelte';
import { readonly, writable, type Readable } from 'svelte/store';
import { toShieldLabsError } from './errors.js';
import { DEFAULT_TIMEOUT, isBrowser, isObject, MAX_TIMEOUT, timeoutOf, userKeyOf, withTimeLeft } from './internal.js';

/**
 * State of the agent: `'loading'` until it is loaded, then `'ready'`, or `'error'` when loading failed.
 * After a load timeout the import keeps running, and an agent that arrives late still makes it `'ready'`.
 */
export type ShieldLabsStatus = 'loading' | 'ready' | 'error';

/** The `checkOnLoad` object form: a background check for a signed-in user. */
export interface CheckOnLoadOptions {
  /** User HID computed on your server. Omit it for an anonymous check. */
  userId?: string;
}

/** Options of {@link setShieldLabs}: the `@shieldlabs-ai/js` load options plus `checkOnLoad` and `autoLoad`. */
export interface ShieldLabsOptions extends LoadOptions {
  /**
   * Runs `check()` once when the agent is ready, for passive monitoring of the visit, unless an
   * identification or check for the same User HID is running at that moment. `true` runs an
   * anonymous check, `{ userId }` a check for a signed-in user. Default `false`.
   */
  checkOnLoad?: boolean | CheckOnLoadOptions;
  /**
   * Loads the agent when the component that calls `setShieldLabs()` mounts. Default `true`. With
   * `false` (any value other than `true` or no value), nothing loads until `load()` is called, for
   * example once the visitor has given consent. Until then nothing waits for it: `identify()` fails
   * at once with `not_initialized` (the one of `useIdentify()` resolves `null`, and so does a
   * `runOnMount` identification, which does not run again after `load()`), `check()` resolves
   * `null`, and only `getAgent()` waits for `load()`.
   */
  autoLoad?: boolean;
}

/** What {@link getShieldLabs} returns: the status of the agent as readable stores, plus its calls. */
export interface ShieldLabsContext {
  /** `'loading'`, `'ready'` or `'error'`. Stays `'loading'` during server-side rendering and until `load()` with `autoLoad: false`. */
  readonly status: Readable<ShieldLabsStatus>;
  /** Why loading failed (`status` is `'error'`), otherwise `null`. */
  readonly error: Readable<ShieldLabsError | null>;
  /**
   * Waits for the agent, then runs a fresh identification (a new request ID on every call). Rejects
   * with a `ShieldLabsError`: with `autoLoad: false` before `load()`, at once with `not_initialized`,
   * and with the error of a load that failed or timed out. The `timeout` of the call (by default the
   * setup `timeout`) covers the whole call: the wait for the agent to load and the agent's answer.
   * For a submit handler with loading and error state, use `useIdentify()`.
   */
  readonly identify: (options?: IdentifyOptions) => Promise<IdentifyResult>;
  /**
   * Waits for the agent, then runs its limited background check (one per visit every five minutes).
   * Resolves `null` when the agent skipped the check, and at once with `autoLoad: false` before
   * `load()`. Rejects with a `ShieldLabsError`. The `timeout` covers the whole call, as for
   * `identify()`.
   */
  readonly check: (options?: IdentifyOptions) => Promise<IdentifyResult | null>;
  /**
   * Starts loading the agent. Needed once with `autoLoad: false`, for example after consent; until
   * then nothing loads, `identify()` and `check()` do not wait for it, and `getAgent()` does. It also
   * tries again after a failed load. It does nothing while the agent loads or once it is loaded, and
   * nothing during server-side rendering, so it is safe to call from component initialisation: call
   * it there when consent is already known, so that `runOnMount` identifications wait for the agent.
   */
  readonly load: () => void;
  /**
   * The agent of `@shieldlabs-ai/js` once it is loaded, for example for
   * `agent.identifyOnInteraction(form)`. Loads it like a call does, or with `autoLoad: false` waits
   * for `load()`. It has no timeout of its own, and rejects with the error of a load that failed or
   * timed out (the setup `timeout`), also when the agent arrives later.
   */
  readonly getAgent: () => Promise<ShieldLabsAgent>;
}

/** What setShieldLabs() stores in the component context. Internal: not exported from the package. */
export interface ShieldLabsState {
  readonly context: ShieldLabsContext;
  /**
   * Calls `call` with the agent and the options for it. When the agent is loaded, at once and with
   * the options unchanged. Otherwise once it has loaded, with what is left of the call's timeout
   * (its own, or the setup `timeout`) as the `timeout`. Rejects with the load error, or with
   * `timeout` when the agent did not load in time. With `autoLoad: false` before `load()`, rejects at
   * once with `not_initialized` and loads nothing. Until it settles, the call counts as running for
   * its User HID, which holds back `checkOnLoad`, as long as `willIdentify` returns `true`.
   */
  readonly withAgent: <T>(
    callOptions: unknown,
    call: (agent: ShieldLabsAgent, agentOptions: unknown) => T | PromiseLike<T>,
    willIdentify?: () => boolean,
  ) => Promise<T>;
  /** The timeout of a call without one of its own: the setup `timeout`, else 10000 ms. */
  readonly defaultTimeout: number;
}

const KEY = Symbol('shieldlabs');

/** The options for load(): everything except checkOnLoad and autoLoad, passed through unchanged. */
function loadOptionsOf(options: unknown): LoadOptions {
  // Anything that is not an object reaches load(), which rejects it with invalid_options.
  if (!isObject(options)) return options as LoadOptions;
  const { checkOnLoad, autoLoad, ...loadOptions } = options;
  return loadOptions as unknown as LoadOptions;
}

/** The options for the checkOnLoad check, or `false` for no check. */
function checkOptionsOf(options: unknown): IdentifyOptions | undefined | false {
  const checkOnLoad = isObject(options) ? options.checkOnLoad : undefined;
  if (checkOnLoad === true) return undefined;
  if (isObject(checkOnLoad)) return { userId: checkOnLoad.userId as string | undefined };
  return false;
}

/**
 * Loads on mount only for `autoLoad: true` or no `autoLoad`. Any other value waits for `load()`,
 * because a value that was meant to be `false` must not load the agent before consent. Options that
 * are not an object load on mount, so that `load()` reports them as `invalid_options`.
 */
function autoLoadOf(options: unknown): boolean {
  return !isObject(options) || options.autoLoad === undefined || options.autoLoad === true;
}

/** `load()` of `@shieldlabs-ai/js`, rejecting with a `ShieldLabsError` whatever goes wrong. */
function loadAgent(options: LoadOptions): Promise<ShieldLabsAgent> {
  return new Promise<ShieldLabsAgent>((resolve) => {
    resolve(load(options));
  }).then(undefined, (reason: unknown) => {
    throw toShieldLabsError(reason, 'load_failed');
  });
}

/** The error of an identify() made with `autoLoad: false` before load(). */
function notLoaded(): ShieldLabsError {
  return new ShieldLabsError(
    'not_initialized',
    'The ShieldLabs agent is not loaded: setShieldLabs() has autoLoad: false and load() has not been called.',
  );
}

function ignore(): void {
  // Reported through `status` and `error`.
}

function always(): boolean {
  return true;
}

/** An identify() or check() call that runs: its User HID (see userKeyOf()) and whether it will still identify. */
interface RunningCall {
  readonly key: string | undefined;
  readonly willIdentify: () => boolean;
}

/**
 * Sets up ShieldLabs for this component and its children. Call it once during initialisation of
 * your root component (in SvelteKit, the root `+layout.svelte`). The agent starts loading when the
 * component mounts in the browser, never during server-side rendering, and loading goes through the
 * memoized `load()` of `@shieldlabs-ai/js`, so mounting twice imports the agent once. With
 * `autoLoad: false` it starts loading only when `load()` is called.
 *
 * The options are read once. Pass a function that returns them to use props such as `data`
 * without Svelte's "only captures the initial value" warning.
 *
 * Returns the same object as {@link getShieldLabs}.
 */
export function setShieldLabs(options: ShieldLabsOptions | (() => ShieldLabsOptions)): ShieldLabsContext {
  const resolved: unknown = typeof options === 'function' ? options() : options;
  const loadOptions = loadOptionsOf(resolved);
  const checkOptions = checkOptionsOf(resolved);
  const checkKey = checkOptions === false ? undefined : userKeyOf(checkOptions);
  // The time a call without a timeout of its own may take in all.
  const setupTimeout = timeoutOf(resolved) ?? DEFAULT_TIMEOUT;
  const status = writable<ShieldLabsStatus>('loading');
  const error = writable<ShieldLabsError | null>(null);
  /** The agent, once it is loaded. It stays loaded for the rest of the page's life. */
  let loaded: ShieldLabsAgent | undefined;
  /** The running load() with the setup timeout, which also updates `status` and `error`. */
  let attempt: Promise<ShieldLabsAgent> | undefined;
  /** The wait for an import that is still running after a load timed out. */
  let lateWait: Promise<ShieldLabsAgent> | undefined;
  /** `false` while `autoLoad: false` holds back loading until load() is called. */
  let allowed = autoLoadOf(resolved);
  /** getAgent() calls that wait for load(). */
  const waitingForLoad = new Set<() => void>();
  /** The identify() and check() calls that run, from the call until they settle. */
  const running = new Set<RunningCall>();
  let mounted = false;
  let checked = false;
  let warned = false;

  const runCheckOnLoad = (): void => {
    if (checkOptions === false || checked || !loaded) return;
    checked = true;
    // A call for the same User HID identifies the visit already, and the agent runs one
    // identification per User HID at a time: a check now would only compete with it.
    for (const call of running) {
      if (call.key !== undefined && call.key === checkKey && call.willIdentify()) return;
    }
    const agent = loaded;
    new Promise<IdentifyResult | null>((resolve) => {
      resolve(agent.check(checkOptions));
    }).then(undefined, (reason: unknown) => {
      // A background check that did not run is not an error of the page. Only a wrong
      // checkOnLoad value (a reserved or empty User HID) is worth telling the developer about.
      if (reason instanceof ShieldLabsError && reason.code === 'invalid_options') {
        console.warn('[ShieldLabs] checkOnLoad: ' + reason.message);
      }
    });
  };

  /**
   * Keeps the first agent that arrives for the rest of the page's life, makes the status ready and
   * returns that agent, so that every call uses the same one. `error` is always updated before
   * `status`, so that a subscriber to `status` reads the matching error.
   */
  const onReady = (agent: ShieldLabsAgent): ShieldLabsAgent => {
    if (loaded) return loaded;
    // Before `status`, so that a subscriber that identifies when it turns 'ready' gets the agent at
    // once, and counts as running before checkOnLoad looks.
    loaded = agent;
    error.set(null);
    status.set('ready');
    if (mounted) runCheckOnLoad();
    return agent;
  };

  const onFailure = (failure: ShieldLabsError): void => {
    error.set(failure);
    status.set('error');
  };

  // A load that fails for a reason that loading again cannot fix is a setup problem, for example an
  // empty or wrong publicKey, or a page served without HTTPS. The stores alone are easy to miss, so it
  // also goes to the console, once. Blocked downloads and timeouts are normal for some visitors.
  const warnSetupProblem = (failure: ShieldLabsError): void => {
    if (warned || (failure.code !== 'invalid_options' && failure.code !== 'unsupported_environment')) return;
    warned = true;
    console.warn('[ShieldLabs] setShieldLabs() could not load the agent: ' + failure.message);
  };

  // When loading times out, load() keeps the import running. Wait for that same import (no new
  // request), so that an agent that arrives late still makes the status ready and runs checkOnLoad.
  // Nothing else waits for it: the calls, getAgent() and runOnMount identifications that waited for
  // the load end with its timeout, and none of them runs again when the agent arrives.
  const waitForLateAgent = (): void => {
    if (lateWait) return;
    const waiting = loadAgent({ ...loadOptions, timeout: MAX_TIMEOUT })
      // The agent of that call would wait as long for every answer: use one with the configured timeout.
      .then(() => loadAgent(loadOptions))
      .then(onReady);
    lateWait = waiting;
    waiting.then(
      () => {
        lateWait = undefined;
      },
      (reason: unknown) => {
        // The import failed after all. The next call or load() imports the agent again.
        lateWait = undefined;
        if (!loaded) onFailure(toShieldLabsError(reason, 'load_failed'));
      },
    );
  };

  // One load() at a time while the agent is not loaded: on mount, on load(), and for calls that come
  // before it is ready. A failed load is not kept, so the next one tries again.
  const startLoading = (): Promise<ShieldLabsAgent> => {
    if (loaded) return Promise.resolve(loaded);
    if (attempt) return attempt;
    error.set(null);
    status.set('loading');
    const loading = loadAgent(loadOptions).then(onReady);
    attempt = loading;
    loading.then(
      () => {
        attempt = undefined;
      },
      (reason: unknown) => {
        attempt = undefined;
        if (loaded) return;
        const failure = toShieldLabsError(reason, 'load_failed');
        warnSetupProblem(failure);
        onFailure(failure);
        if (mounted && failure.code === 'timeout') waitForLateAgent();
      },
    );
    return loading;
  };

  /** `true` in the browser while `autoLoad: false` holds back loading until load() is called. */
  const beforeLoad = (): boolean => !allowed && isBrowser();

  /** Runs `start` now, or with `autoLoad: false` once load() is called. On the server, now: load() refuses it there. */
  const afterLoad = (start: () => void): void => {
    if (beforeLoad()) waitingForLoad.add(start);
    else start();
  };

  /**
   * The loaded agent. Starts loading when it is not loaded. Rejects with the error of a load that
   * failed or timed out, unless an agent that arrived late is ready by then.
   */
  const untilLoaded = (): Promise<ShieldLabsAgent> =>
    startLoading().then(undefined, (reason: unknown) => {
      if (loaded) return loaded;
      throw toShieldLabsError(reason, 'load_failed');
    });

  const withAgent = <T>(
    callOptions: unknown,
    call: (agent: ShieldLabsAgent, agentOptions: unknown) => T | PromiseLike<T>,
    willIdentify: () => boolean = always,
  ): Promise<T> => {
    // A call does not wait for load(): that could hold up a protected action until its timeout. It
    // fails at once, and the action goes ahead without a request ID. On the server the call goes on,
    // and load() refuses it with unsupported_environment.
    if (beforeLoad()) return Promise.reject(notLoaded());
    const entry: RunningCall = { key: userKeyOf(callOptions), willIdentify };
    running.add(entry);
    const result = new Promise<T>((resolve, reject) => {
      if (loaded) {
        resolve(call(loaded, callOptions));
        return;
      }
      // One budget for the whole call: the wait for the agent to load and the agent's answer.
      const budget = timeoutOf(callOptions) ?? setupTimeout;
      const deadline = Date.now() + budget;
      const timedOut = (): ShieldLabsError =>
        new ShieldLabsError('timeout', 'The ShieldLabs agent did not load within ' + String(budget) + ' ms.');
      let settled = false;
      const timer = setTimeout(() => {
        fail(timedOut());
      }, budget);
      const settle = (): boolean => {
        if (settled) return false;
        settled = true;
        clearTimeout(timer);
        return true;
      };
      const fail = (failure: ShieldLabsError): void => {
        if (settle()) reject(failure);
      };
      const proceed = (agent: ShieldLabsAgent): void => {
        if (!settle()) return;
        // The agent gets what is left of the budget, never more (even when the clock was set back).
        const left = Math.min(budget, deadline - Date.now());
        if (left < 1) {
          reject(timedOut());
          return;
        }
        // A `call` that throws rejects like one that returns a rejected promise.
        new Promise<T>((done) => {
          done(call(agent, withTimeLeft(callOptions, left)));
        }).then(resolve, reject);
      };
      // A load that fails or times out ends the call with its error, even when the call has time left.
      untilLoaded().then(proceed, (reason: unknown) => {
        fail(toShieldLabsError(reason, 'load_failed'));
      });
    });
    const finished = (): void => {
      running.delete(entry);
    };
    result.then(finished, finished);
    return result;
  };

  // No timeout of its own: it waits for load(), then for the load, and rejects with the error of a
  // load that fails or times out.
  const getAgent = (): Promise<ShieldLabsAgent> =>
    new Promise<ShieldLabsAgent>((resolve, reject) => {
      if (loaded) {
        resolve(loaded);
        return;
      }
      afterLoad(() => {
        untilLoaded().then(resolve, reject);
      });
    });

  const startNow = (): void => {
    // Nothing loads during server-side rendering, where component initialisation also runs.
    if (!isBrowser()) return;
    if (!allowed) {
      allowed = true;
      const waiting = [...waitingForLoad];
      waitingForLoad.clear();
      for (const start of waiting) start();
    }
    startLoading().then(undefined, ignore);
  };

  const context: ShieldLabsContext = {
    status: readonly(status),
    error: readonly(error),
    identify: (identifyOptions) =>
      withAgent(identifyOptions, (agent, agentOptions) => agent.identify(agentOptions as IdentifyOptions | undefined)),
    // Before load() the check is skipped at once, as the agent skips a check it does not run.
    check: (identifyOptions) =>
      beforeLoad()
        ? Promise.resolve(null)
        : withAgent(identifyOptions, (agent, agentOptions) => agent.check(agentOptions as IdentifyOptions | undefined)),
    load: startNow,
    getAgent,
  };

  setContext<ShieldLabsState>(KEY, { context, withAgent, defaultTimeout: setupTimeout });

  // onMount never runs during server-side rendering, so the agent only loads in the browser.
  onMount(() => {
    mounted = true;
    if (allowed) startLoading().then(undefined, ignore);
    // The agent may be ready already, when load() ran during initialisation.
    runCheckOnLoad();
    return () => {
      mounted = false;
    };
  });

  return context;
}

/** The state set up by setShieldLabs() in a parent component. Internal. */
export function getShieldLabsState(caller: string): ShieldLabsState {
  const state = getContext<ShieldLabsState | undefined>(KEY);
  if (!state) {
    throw new Error(
      '[ShieldLabs] ' +
        caller +
        ' found no ShieldLabs setup. Call setShieldLabs() in a parent component (in SvelteKit, the root +layout.svelte).',
    );
  }
  return state;
}

/**
 * The status and the calls of the ShieldLabs agent set up by {@link setShieldLabs} in a parent
 * component. Call it during component initialisation.
 */
export function getShieldLabs(): ShieldLabsContext {
  return getShieldLabsState('getShieldLabs()').context;
}
