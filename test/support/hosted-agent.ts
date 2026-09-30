/**
 * A stand-in for the hosted agent module that `@shieldlabs/js` imports from the CDN, with the
 * callback contract of the real one: four exports, only `options.onInitialized` is read, and the
 * callback runs asynchronously, exactly once per call, with `{ status: 'initialized', requestID }`.
 * Force calls always run; non-force calls run once per five-minute window.
 */

export interface HostedAgentCall {
  name: string;
  userHid?: unknown;
}

interface CallOptions {
  onInitialized?: (answer: object) => void;
}

const WINDOW_MS = 5 * 60 * 1000;

/** Records every call in `calls` (a new array unless one is given). */
export function createHostedAgent(calls: HostedAgentCall[] = []) {
  let counter = 0;
  let lastCheckAt = Number.NEGATIVE_INFINITY;

  const run = (name: string, force: boolean, options: unknown, userHid?: unknown): void => {
    calls.push(userHid === undefined ? { name } : { name, userHid });
    const handler = (options as CallOptions | undefined)?.onInitialized;
    const now = Date.now();
    let answer: object;
    if (!force && now - lastCheckAt < WINDOW_MS) {
      answer = Object.freeze({ status: 'not_initialized' });
    } else {
      if (!force) lastCheckAt = now;
      counter += 1;
      answer = Object.freeze({
        status: 'initialized',
        requestID: `2c5ea4c0-4067-4d2b-8b9e-${counter.toString(16).padStart(12, '0')}`,
      });
    }
    queueMicrotask(() => {
      handler?.(answer);
    });
  };

  // Like the real agent, the exports return undefined and answer through onInitialized only.
  const module = {
    checkAnonymous: (options?: unknown): void => {
      run('checkAnonymous', false, options);
    },
    checkAuthenticatedUser: (userHid: unknown, options?: unknown): void => {
      run('checkAuthenticatedUser', false, options, userHid);
    },
    forceCheckAnonymous: (options?: unknown): void => {
      run('forceCheckAnonymous', true, options);
    },
    forceCheckAuthenticatedUser: (userHid: unknown, options?: unknown): void => {
      run('forceCheckAuthenticatedUser', true, options, userHid);
    },
  };

  return { module, calls };
}
