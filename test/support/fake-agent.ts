import { ShieldLabsError, type IdentifyOptions, type IdentifyResult, type load, type ShieldLabsAgent } from '@shieldlabs/js';
import { tick } from 'svelte';
import { vi, type Mock } from 'vitest';

/** A fake 32-hex Public Key, the shape issued today. */
export const PUBLIC_KEY = '0123456789abcdef0123456789abcdef';

/** A User HID as the server SDKs compute it: 64 lowercase hex characters. */
export const USER_HID = '5d41402abc4b2a76b9719d911017c5925d41402abc4b2a76b9719d911017c592';

/** Another User HID. */
export const OTHER_HID = 'b1946ac92492d2347c6235b4d2611184b1946ac92492d2347c6235b4d2611184';

let counter = 0;

/** Deterministic UUIDv4-shaped request IDs. */
export function nextRequestId(): string {
  counter += 1;
  return `9b1deb4d-3b7d-4bad-9bdd-${counter.toString(16).padStart(12, '0')}`;
}

/** The agent object that `load()` resolves, with spies. Answers with a new request ID by default. */
export interface FakeAgent extends ShieldLabsAgent {
  identify: Mock<(options?: IdentifyOptions) => Promise<IdentifyResult>>;
  check: Mock<(options?: IdentifyOptions) => Promise<IdentifyResult | null>>;
}

export function createFakeAgent(): FakeAgent {
  const answer = (options?: IdentifyOptions): Promise<IdentifyResult> =>
    Promise.resolve({ requestId: nextRequestId(), userId: options?.userId ?? null });
  return {
    identify: vi.fn(answer),
    check: vi.fn(answer),
    identifyOnInteraction: vi.fn(() => {
      throw new Error('identifyOnInteraction is not used by the bindings');
    }),
  };
}

export interface Deferred<T> {
  promise: Promise<T>;
  resolve(value: T): void;
  reject(reason: unknown): void;
}

/** A promise that the test settles by hand. */
export function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((onResolve, onReject) => {
    resolve = onResolve;
    reject = onReject;
  });
  return { promise, resolve, reject };
}

/** The error of a load that timed out, as `@shieldlabs/js` words it. */
export function loadTimedOut(ms = 10000): ShieldLabsError {
  return new ShieldLabsError('timeout', 'The ShieldLabs agent did not load within ' + String(ms) + ' ms.');
}

/**
 * Makes the `load()` mock behave like the real loader over time: every call shares one import that
 * the test settles, and each call rejects with `timeout` after its own `timeout` (default 10000 ms)
 * while the import goes on. Use it with fake timers.
 */
export function sharedImport(loadMock: Mock<typeof load>): Deferred<ShieldLabsAgent> {
  const imported = deferred<ShieldLabsAgent>();
  loadMock.mockImplementation(
    (options) =>
      new Promise<ShieldLabsAgent>((resolve, reject) => {
        const ms = options.timeout ?? 10000;
        const timer = setTimeout(() => {
          reject(loadTimedOut(ms));
        }, ms);
        imported.promise.then(
          (agent) => {
            clearTimeout(timer);
            resolve(agent);
          },
          (reason: unknown) => {
            clearTimeout(timer);
            reject(reason instanceof Error ? reason : new Error(String(reason)));
          },
        );
      }),
  );
  return imported;
}

/** Lets pending promise reactions run, then lets Svelte apply the resulting DOM updates. */
export async function settle(): Promise<void> {
  for (let i = 0; i < 20; i += 1) await Promise.resolve();
  await tick();
}
