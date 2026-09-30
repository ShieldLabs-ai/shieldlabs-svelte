/** The largest delay that `setTimeout` accepts, and the largest `timeout` that `@shieldlabs/js` accepts. Internal. */
export const MAX_TIMEOUT = 2147483647;

/** The `timeout` of `@shieldlabs/js` when none is given: 10 seconds. Internal. */
export const DEFAULT_TIMEOUT = 10000;

/** `true` for objects (arrays included), `false` for `null` and primitives. Internal. */
export function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

/**
 * `true` on a browser page, the only place where `@shieldlabs/js` loads the agent. It only checks
 * that the globals exist and reads nothing from them. Internal.
 */
export function isBrowser(): boolean {
  return typeof window !== 'undefined' && typeof document !== 'undefined';
}

/** The `timeout` of call options when `@shieldlabs/js` would accept it, otherwise `undefined`. Internal. */
export function timeoutOf(options: unknown): number | undefined {
  if (!isObject(options)) return undefined;
  const { timeout } = options;
  return typeof timeout === 'number' && timeout > 0 && timeout <= MAX_TIMEOUT ? timeout : undefined;
}

/**
 * The options for an agent call that first waited for the agent to load: the time left of the call
 * becomes its `timeout`. Options that `@shieldlabs/js` refuses (not an object, or an invalid
 * `timeout`) stay as they are, so that it still refuses them with `invalid_options`. Internal.
 */
export function withTimeLeft(options: unknown, ms: number): unknown {
  if (options === undefined || options === null) return { timeout: ms };
  if (!isObject(options)) return options;
  if (options.timeout !== undefined && timeoutOf(options) === undefined) return options;
  return { ...options, timeout: ms };
}

/**
 * The User HID that call options identify: `'anonymous'` or `'user:'` plus the User HID, or
 * `undefined` for options that `@shieldlabs/js` refuses before any identification starts. Internal.
 */
export function userKeyOf(options: unknown): string | undefined {
  if (options === undefined || options === null) return 'anonymous';
  if (!isObject(options)) return undefined;
  const { userId } = options;
  if (userId === undefined || userId === null) return 'anonymous';
  return typeof userId === 'string' ? 'user:' + userId : undefined;
}
