import type { IdentifyOptions, IdentifyResult, ShieldLabsError } from '@shieldlabs-ai/js';
import { onMount } from 'svelte';
import { readonly, writable, type Readable } from 'svelte/store';
import { getShieldLabsState } from './context.js';
import { toShieldLabsError } from './errors.js';
import { isObject } from './internal.js';

/** Options of {@link useIdentify}. */
export interface UseIdentifyOptions extends IdentifyOptions {
  /**
   * Runs `identify()` once as soon as the agent is ready after the component mounts. When the load
   * fails or times out, or the timeout of the identification runs out first, it ends with that
   * error and does not run again when the agent arrives later. With `autoLoad: false`, call `load()`
   * before the component mounts: an identification that starts before `load()` resolves `null` at
   * once with a `not_initialized` error, like `identify()`, and does not run again after `load()`.
   * Every identification is billable, so use it sparingly. Default `false`.
   */
  runOnMount?: boolean;
}

/** What {@link useIdentify} returns. */
export interface IdentifyHelper {
  /** The latest identification of this helper, `null` before the first one, while one runs and after an error. */
  readonly result: Readable<IdentifyResult | null>;
  /** `true` while an identification of this helper runs (including the wait for the agent). */
  readonly isLoading: Readable<boolean>;
  /** Why the latest identification failed, otherwise `null`. */
  readonly error: Readable<ShieldLabsError | null>;
  /**
   * Runs a fresh identification and resolves its result, or `null` when it failed (the reason is in
   * `error`). Never rejects. With `autoLoad: false` before `load()`, resolves `null` at once with a
   * `not_initialized` error. Options override the ones given to `useIdentify()`. The `timeout` (the
   * call's, else the one given to `useIdentify()`, else the setup `timeout`) covers the whole call:
   * the wait for the agent to load and the agent's answer. While an identification of this helper
   * with the same User HID and the same timeout runs, returns that one instead of starting another,
   * and the stores follow it.
   */
  readonly identify: (options?: IdentifyOptions) => Promise<IdentifyResult | null>;
  /** Clears `result` and `error`. An identification that is still running no longer updates the stores. */
  readonly reset: () => void;
}

interface Run {
  key: string;
  promise: Promise<IdentifyResult | null>;
}

/** What started an identification: a call of `identify()`, or `runOnMount`. */
type Trigger = 'call' | 'mount';

/**
 * The options for the agent: the call options over the helper options, without `runOnMount`.
 * Options that are not an object (possible without TypeScript, for example a bare User HID) reach
 * the agent unchanged, so that `@shieldlabs-ai/js` rejects them with `invalid_options` instead of
 * running an anonymous identification.
 */
function agentOptionsOf(helperOptions: unknown, callOptions: unknown): unknown {
  if (callOptions != null && !isObject(callOptions)) return callOptions;
  if (helperOptions != null && !isObject(helperOptions)) return helperOptions;
  const { runOnMount, ...defaults } = (helperOptions ?? {}) as UseIdentifyOptions;
  return { ...defaults, ...(callOptions as IdentifyOptions | null | undefined) };
}

/**
 * Identifications with the same User HID and the same timeout share one run. Merged options without
 * a `timeout` run with `defaultTimeout` (the setup `timeout`), so they count with that one.
 */
function keyOf(options: unknown, defaultTimeout: number): string {
  // Refused by @shieldlabs-ai/js with invalid_options: never shared with a run that can succeed.
  if (!isObject(options)) return 'invalid:' + typeof options;
  const { userId } = options;
  let user: string;
  if (userId === undefined || userId === null) user = 'anonymous';
  // Anything but a string is refused by @shieldlabs-ai/js with invalid_options.
  else user = typeof userId === 'string' ? 'user:' + userId : 'other:' + typeof userId;
  // A timeout that @shieldlabs-ai/js refuses keeps its type, so that it is never shared with a valid one.
  const timeout: unknown = options.timeout === undefined ? defaultTimeout : options.timeout;
  return JSON.stringify([user, typeof timeout, String(timeout)]);
}

/**
 * An identify helper with loading and error state, for the ShieldLabs setup of a parent component.
 * Call it during component initialisation. It identifies only when you call `identify()`, or once
 * per mount with `runOnMount`: never because the component re-renders.
 *
 * Pass a function that returns the options to read them when an identification starts, for example
 * a User HID from props that can change after sign-in.
 */
export function useIdentify(options?: UseIdentifyOptions | (() => UseIdentifyOptions | undefined)): IdentifyHelper {
  const state = getShieldLabsState('useIdentify()');
  const read = (): unknown => (typeof options === 'function' ? options() : options);
  const result = writable<IdentifyResult | null>(null);
  const isLoading = writable(false);
  const error = writable<ShieldLabsError | null>(null);
  /** The identification whose outcome the stores show: the one asked for last. */
  let current: Run | undefined;
  /** The identifications of this helper that have not settled yet. reset() forgets them. */
  const runs = new Set<Run>();
  let mounted = false;

  const start = (callOptions: IdentifyOptions | undefined, trigger: Trigger): Promise<IdentifyResult | null> => {
    const agentOptions = agentOptionsOf(read(), callOptions);
    const key = keyOf(agentOptions, state.defaultTimeout);
    // A double submit must not spend a second identification (the agent would also refuse a
    // second one for the same User HID while the first runs), also when other identifications of
    // this helper started in between.
    for (const running of runs) {
      if (running.key !== key) continue;
      if (current !== running) {
        // The stores follow the identification that this call returns.
        current = running;
        result.set(null);
        error.set(null);
        isLoading.set(true);
      }
      return running.promise;
    }

    result.set(null);
    error.set(null);
    isLoading.set(true);

    // runOnMount skips the identification when the component is gone by the time the agent is ready.
    const willIdentify = (): boolean => trigger === 'call' || mounted;
    const promise = state
      .withAgent(
        agentOptions,
        (agent, options) => {
          // The component went away before the agent was ready: do not spend an identification.
          if (!willIdentify()) return null;
          return agent.identify(options as IdentifyOptions | undefined);
        },
        willIdentify,
      )
      .then(
        (value) => {
          runs.delete(run);
          if (current === run) {
            current = undefined;
            result.set(value);
            isLoading.set(false);
          }
          return value;
        },
        (reason: unknown) => {
          runs.delete(run);
          if (current === run) {
            current = undefined;
            // Also for runOnMount: after a failed or timed-out load it ends here, and an agent that
            // arrives later does not start it again.
            error.set(toShieldLabsError(reason, 'not_initialized'));
            isLoading.set(false);
          }
          return null;
        },
      );
    const run: Run = { key, promise };
    runs.add(run);
    current = run;
    return promise;
  };

  onMount(() => {
    mounted = true;
    const initial = read();
    // With autoLoad: false before load(), this ends at once with not_initialized, like identify(),
    // and load() does not start it again.
    if (isObject(initial) && initial.runOnMount === true) void start(undefined, 'mount');
    return () => {
      mounted = false;
    };
  });

  return {
    result: readonly(result),
    isLoading: readonly(isLoading),
    error: readonly(error),
    identify: (callOptions) => start(callOptions, 'call'),
    reset: () => {
      current = undefined;
      runs.clear();
      result.set(null);
      error.set(null);
      isLoading.set(false);
    },
  };
}
