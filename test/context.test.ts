import { load, ShieldLabsError, type ShieldLabsAgent } from '@shieldlabs-ai/js';
import { render, screen } from '@testing-library/svelte';
import { get } from 'svelte/store';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ShieldLabsContext, ShieldLabsOptions, ShieldLabsStatus } from '../src/lib/index.js';
import App from './components/App.svelte';
import LegacyApp from './components/LegacyApp.svelte';
import Orphan from './components/Orphan.svelte';
import SameComponent from './components/SameComponent.svelte';
import {
  createFakeAgent,
  deferred,
  loadTimedOut,
  OTHER_HID,
  PUBLIC_KEY,
  settle,
  sharedImport,
  USER_HID,
  type FakeAgent,
} from './support/fake-agent.js';

vi.mock('@shieldlabs-ai/js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@shieldlabs-ai/js')>();
  return { ...actual, load: vi.fn() };
});

const loadMock = vi.mocked(load);

function renderApp(options: ShieldLabsOptions = { publicKey: PUBLIC_KEY }) {
  let context: ShieldLabsContext | undefined;
  const view = render(App, {
    props: {
      options,
      onsetup: (value: ShieldLabsContext) => {
        context = value;
      },
    },
  });
  if (!context) throw new Error('setShieldLabs() did not run');
  return { view, context };
}

function recordStatus(context: ShieldLabsContext): ShieldLabsStatus[] {
  const seen: ShieldLabsStatus[] = [];
  context.status.subscribe((value) => seen.push(value));
  return seen;
}

describe('setShieldLabs() and getShieldLabs()', () => {
  let agent: FakeAgent;

  beforeEach(() => {
    agent = createFakeAgent();
    loadMock.mockReset();
    loadMock.mockResolvedValue(agent);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('starts in loading and becomes ready once the agent is loaded', async () => {
    const loading = deferred<ShieldLabsAgent>();
    loadMock.mockReturnValue(loading.promise);
    const { context } = renderApp();

    expect(screen.getByTestId('root-status').textContent).toBe('loading');
    expect(screen.getByTestId('status').textContent).toBe('loading');
    expect(get(context.error)).toBeNull();

    loading.resolve(agent);
    await settle();

    expect(screen.getByTestId('root-status').textContent).toBe('ready');
    expect(screen.getByTestId('status').textContent).toBe('ready');
    expect(get(context.error)).toBeNull();
  });

  it('loads through load() of @shieldlabs-ai/js once per mount, with the load options unchanged', async () => {
    renderApp({
      publicKey: PUBLIC_KEY,
      environment: 'development',
      scriptUrl: 'https://agent.example.com/snippet.js',
      timeout: 5000,
      checkOnLoad: true,
      autoLoad: true,
    });
    await settle();

    expect(loadMock).toHaveBeenCalledTimes(1);
    expect(loadMock).toHaveBeenCalledWith({
      publicKey: PUBLIC_KEY,
      environment: 'development',
      scriptUrl: 'https://agent.example.com/snippet.js',
      timeout: 5000,
    });
  });

  it('does not identify or check while loading the agent', async () => {
    renderApp();
    await settle();

    expect(agent.identify).not.toHaveBeenCalled();
    expect(agent.check).not.toHaveBeenCalled();
  });

  it('reports a failed load in status and error', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const failure = new ShieldLabsError('load_failed', 'Could not load the ShieldLabs agent.');
    loadMock.mockRejectedValue(failure);
    const { context } = renderApp();
    await settle();

    expect(screen.getByTestId('status').textContent).toBe('error');
    expect(screen.getByTestId('error').textContent).toBe('load_failed: Could not load the ShieldLabs agent.');
    expect(screen.getByTestId('root-error').textContent).toBe('load_failed');
    expect(get(context.error)).toBe(failure);
    // Only a timeout leaves an import running that is worth waiting for.
    expect(loadMock).toHaveBeenCalledTimes(1);
    // A blocked or failed download is normal for some visitors: nothing in the console.
    expect(warn).not.toHaveBeenCalled();
  });

  describe('a setup that cannot load the agent', () => {
    it('warns once in the console about invalid options', async () => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
      const failure = new ShieldLabsError('invalid_options', 'publicKey must match ^[A-Za-z0-9_-]{1,128}$.');
      loadMock.mockRejectedValue(failure);
      const { context } = renderApp({ publicKey: '' });
      await settle();

      expect(get(context.error)).toBe(failure);
      // Every later call fails the same way, but the console gets the message once.
      await expect(context.identify()).rejects.toBe(failure);
      await expect(context.check()).rejects.toBe(failure);
      await expect(context.getAgent()).rejects.toBe(failure);
      expect(warn).toHaveBeenCalledTimes(1);
      expect(warn).toHaveBeenCalledWith(
        '[ShieldLabs] setShieldLabs() could not load the agent: publicKey must match ^[A-Za-z0-9_-]{1,128}$.',
      );
    });

    it('warns once in the console about a page that is not a secure context', async () => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
      loadMock.mockRejectedValue(
        new ShieldLabsError('unsupported_environment', 'The page is not a secure context: the agent needs HTTPS.'),
      );
      renderApp();
      await settle();

      expect(warn).toHaveBeenCalledTimes(1);
      expect(warn).toHaveBeenCalledWith(
        '[ShieldLabs] setShieldLabs() could not load the agent: The page is not a secure context: the agent needs HTTPS.',
      );
    });

    it('stays quiet about a load timeout', async () => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
      loadMock.mockRejectedValueOnce(loadTimedOut()).mockReturnValueOnce(new Promise<ShieldLabsAgent>(() => undefined));
      const { context } = renderApp();
      await settle();

      expect(get(context.error)).toMatchObject({ code: 'timeout' });
      expect(warn).not.toHaveBeenCalled();
    });
  });

  it('wraps an unexpected load failure in a ShieldLabsError', async () => {
    const failure = new TypeError('Failed to fetch dynamically imported module');
    loadMock.mockRejectedValue(failure);
    const { context } = renderApp();
    await settle();

    const error = get(context.error);
    expect(error).toBeInstanceOf(ShieldLabsError);
    expect(error).toMatchObject({ code: 'load_failed', message: failure.message, cause: failure });
  });

  it('wraps a rejection that is not an Error', async () => {
    loadMock.mockRejectedValue('offline');
    const { context } = renderApp();
    await settle();

    expect(get(context.error)).toMatchObject({ code: 'load_failed', message: 'offline', cause: 'offline' });
    // A call rejects with the same error object as the store holds.
    const failed = context.identify();
    await expect(failed).rejects.toMatchObject({ code: 'load_failed', message: 'offline' });
    expect(await failed.catch((reason: unknown) => reason)).toBe(get(context.error));
  });

  it('wraps a load() that throws instead of rejecting', async () => {
    loadMock.mockImplementation(() => {
      throw new Error('synchronous failure');
    });
    const { context } = renderApp();
    await settle();

    expect(get(context.status)).toBe('error');
    expect(get(context.error)).toMatchObject({ code: 'load_failed', message: 'synchronous failure' });
  });

  it('identify() and check() wait for the agent and pass options and results through', async () => {
    vi.useFakeTimers();
    const loading = deferred<ShieldLabsAgent>();
    loadMock.mockReturnValue(loading.promise);
    const { context } = renderApp();
    const options = { userId: USER_HID, timeout: 3000 };

    const identified = context.identify(options);
    const checked = context.check(options);
    await settle();
    expect(agent.identify).not.toHaveBeenCalled();

    loading.resolve(agent);
    const result = await identified;
    expect(result).toEqual({ requestId: expect.stringMatching(/^9b1deb4d-/) as unknown, userId: USER_HID });
    // No time went by while waiting: the agent gets the whole timeout.
    expect(agent.identify).toHaveBeenCalledWith(options);
    expect(await checked).toMatchObject({ userId: USER_HID });
    expect(agent.check).toHaveBeenCalledWith(options);
  });

  it('identify() and check() pass the options unchanged once the agent is loaded', async () => {
    const { context } = renderApp();
    await settle();

    await context.identify();
    await context.check({ userId: USER_HID });
    expect(agent.identify).toHaveBeenCalledWith(undefined);
    expect(agent.check).toHaveBeenCalledWith({ userId: USER_HID });
  });

  it('check() resolves null when the agent skipped the check', async () => {
    agent.check.mockResolvedValue(null);
    const { context } = renderApp();
    await settle();

    await expect(context.check()).resolves.toBeNull();
    expect(agent.check).toHaveBeenCalledWith(undefined);
  });

  it('identify() rejects with the error of the agent and keeps the agent ready', async () => {
    const failure = new ShieldLabsError('not_initialized', 'The agent did not start an identification.');
    agent.identify.mockRejectedValue(failure);
    const { context } = renderApp();

    await expect(context.identify()).rejects.toBe(failure);
    await settle();
    expect(get(context.status)).toBe('ready');
    expect(get(context.error)).toBeNull();
  });

  it('identify() rejects with the load error while the agent cannot be loaded', async () => {
    const failure = new ShieldLabsError('load_failed', 'Blocked by a content blocker.');
    loadMock.mockRejectedValue(failure);
    const { context } = renderApp();

    await expect(context.identify()).rejects.toBe(failure);
    await expect(context.check()).rejects.toBe(failure);
    expect(agent.identify).not.toHaveBeenCalled();
  });

  it('retries loading on the next call after a failed load', async () => {
    const failure = new ShieldLabsError('load_failed', 'Network error.');
    loadMock.mockRejectedValueOnce(failure);
    const { context } = renderApp();
    const seen = recordStatus(context);
    await settle();
    expect(get(context.status)).toBe('error');

    const retry = context.identify();
    // While the agent loads again, the error of the previous attempt is cleared.
    expect(get(context.status)).toBe('loading');
    expect(get(context.error)).toBeNull();
    const result = await retry;
    await settle();

    expect(result).toMatchObject({ userId: null });
    expect(loadMock).toHaveBeenCalledTimes(2);
    expect(seen).toEqual(['loading', 'error', 'loading', 'ready']);
    expect(get(context.error)).toBeNull();
    expect(screen.getByTestId('status').textContent).toBe('ready');
  });

  it('shares one load between the mount and the calls that wait for it', async () => {
    const loading = deferred<ShieldLabsAgent>();
    loadMock.mockReturnValue(loading.promise);
    const { context } = renderApp();

    const identified = context.identify();
    const checked = context.check();
    const found = context.getAgent();
    loading.resolve(agent);
    await Promise.all([identified, checked, found]);

    expect(loadMock).toHaveBeenCalledTimes(1);
  });

  describe('a load that timed out', () => {
    const never = (): Promise<ShieldLabsAgent> => new Promise<ShieldLabsAgent>(() => undefined);

    it('waits for the running import: a late agent makes the status ready and runs checkOnLoad', async () => {
      const late = deferred<ShieldLabsAgent>();
      loadMock.mockRejectedValueOnce(loadTimedOut()).mockReturnValueOnce(late.promise);
      const { context } = renderApp({ publicKey: PUBLIC_KEY, checkOnLoad: true });
      const seen = recordStatus(context);
      await settle();

      expect(get(context.status)).toBe('error');
      expect(get(context.error)).toMatchObject({ code: 'timeout' });
      // load() shares the import that is still running, so waiting sends no new request.
      expect(loadMock).toHaveBeenCalledTimes(2);
      expect(loadMock).toHaveBeenLastCalledWith({ publicKey: PUBLIC_KEY, timeout: 2147483647 });
      expect(agent.check).not.toHaveBeenCalled();

      // The agent of the long wait is not used for calls: checkOnLoad runs on one with the
      // configured timeout.
      const waitAgent = createFakeAgent();
      late.resolve(waitAgent);
      await settle();

      expect(loadMock).toHaveBeenCalledTimes(3);
      expect(loadMock).toHaveBeenLastCalledWith({ publicKey: PUBLIC_KEY });
      expect(seen).toEqual(['loading', 'error', 'ready']);
      expect(get(context.error)).toBeNull();
      expect(screen.getByTestId('status').textContent).toBe('ready');
      expect(agent.check).toHaveBeenCalledTimes(1);
      expect(waitAgent.check).not.toHaveBeenCalled();
    });

    it('reports the failure when the running import fails after all', async () => {
      const late = deferred<ShieldLabsAgent>();
      loadMock.mockRejectedValueOnce(loadTimedOut()).mockReturnValueOnce(late.promise);
      const { context } = renderApp();
      await settle();

      const failure = new ShieldLabsError('load_failed', 'Could not load the ShieldLabs agent.');
      late.reject(failure);
      await settle();

      expect(get(context.status)).toBe('error');
      expect(get(context.error)).toBe(failure);
      expect(loadMock).toHaveBeenCalledTimes(2);
    });

    it('is picked up by the next call', async () => {
      loadMock.mockRejectedValueOnce(loadTimedOut()).mockReturnValueOnce(never());
      const { context } = renderApp();
      await settle();
      expect(get(context.status)).toBe('error');

      await expect(context.check()).resolves.toMatchObject({ userId: null });
      await settle();
      expect(get(context.status)).toBe('ready');
      expect(get(context.error)).toBeNull();
    });

    it('waits once, also when the load of a later call times out too, which ends that call', async () => {
      loadMock.mockRejectedValueOnce(loadTimedOut()).mockReturnValueOnce(never()).mockRejectedValueOnce(loadTimedOut());
      const { context } = renderApp();
      await settle();

      // The load of this call times out as well, and the call ends with that timeout although its
      // own timeout has time left.
      await expect(context.identify({ timeout: 20000 })).rejects.toMatchObject({
        code: 'timeout',
        message: 'The ShieldLabs agent did not load within 10000 ms.',
      });
      await settle();

      // The load on mount, the wait for the late agent and the load of identify().
      expect(loadMock).toHaveBeenCalledTimes(3);
      expect(get(context.status)).toBe('error');
    });

    it('does not wait when the component is gone', async () => {
      const loading = deferred<ShieldLabsAgent>();
      loadMock.mockReturnValueOnce(loading.promise);
      const { view } = renderApp({ publicKey: PUBLIC_KEY, checkOnLoad: true });
      view.unmount();

      loading.reject(loadTimedOut());
      await settle();
      expect(loadMock).toHaveBeenCalledTimes(1);
      expect(agent.check).not.toHaveBeenCalled();
    });

    it('ends the calls that wait with the timeout, and reports an import that fails after all in the status', async () => {
      vi.useFakeTimers();
      const imported = sharedImport(loadMock);
      const { context } = renderApp({ publicKey: PUBLIC_KEY, timeout: 1000 });

      const identified = context.identify({ timeout: 5000 }).catch((reason: unknown) => reason);
      const checked = context.check({ timeout: 5000 }).catch((reason: unknown) => reason);
      await vi.advanceTimersByTimeAsync(1000);
      expect(get(context.error)).toMatchObject({ code: 'timeout' });
      expect(await identified).toMatchObject({ code: 'timeout', message: 'The ShieldLabs agent did not load within 1000 ms.' });
      expect(await checked).toMatchObject({ code: 'timeout', message: 'The ShieldLabs agent did not load within 1000 ms.' });

      const failure = new ShieldLabsError('load_failed', 'Could not load the ShieldLabs agent.');
      imported.reject(failure);
      await settle();
      expect(get(context.error)).toBe(failure);
      expect(get(context.status)).toBe('error');
    });

    it('keeps the status ready when the wait for the late agent fails after the agent arrived', async () => {
      const late = deferred<ShieldLabsAgent>();
      loadMock.mockRejectedValueOnce(loadTimedOut()).mockReturnValueOnce(late.promise);
      const { context } = renderApp();
      await settle();

      // The next call loads the agent.
      await context.identify();
      expect(get(context.status)).toBe('ready');

      late.reject(new ShieldLabsError('load_failed', 'Could not load the ShieldLabs agent.'));
      await settle();
      expect(get(context.status)).toBe('ready');
      expect(get(context.error)).toBeNull();
    });

    it('keeps the status ready when a load fails after the late agent arrived', async () => {
      const late = deferred<ShieldLabsAgent>();
      const second = deferred<ShieldLabsAgent>();
      loadMock
        .mockRejectedValueOnce(loadTimedOut())
        .mockReturnValueOnce(late.promise)
        .mockReturnValueOnce(second.promise);
      const { context } = renderApp();
      await settle();

      const identified = context.identify({ timeout: 60000 });
      late.resolve(createFakeAgent());
      await settle();
      expect(get(context.status)).toBe('ready');

      second.reject(loadTimedOut());
      await settle();
      expect(get(context.status)).toBe('ready');
      expect(get(context.error)).toBeNull();
      // The call still gets the agent that is ready.
      await expect(identified).resolves.toMatchObject({ userId: null });
      expect(agent.identify).toHaveBeenCalledTimes(1);
    });
  });

  it('uses the loaded agent for later calls and stays ready', async () => {
    const { context } = renderApp();
    await settle();
    const seen = recordStatus(context);

    await context.identify();
    await context.check();
    await settle();

    expect(seen).toEqual(['ready']);
    expect(loadMock).toHaveBeenCalledTimes(1);
    expect(agent.identify).toHaveBeenCalledTimes(1);
    expect(agent.check).toHaveBeenCalledTimes(1);
  });

  describe('an agent call that throws', () => {
    const failure = new Error('agent crashed');

    it('rejects like the agent had rejected, once the agent is loaded', async () => {
      agent.identify.mockImplementation(() => {
        throw failure;
      });
      const { context } = renderApp();
      await settle();

      await expect(context.identify()).rejects.toBe(failure);
      expect(get(context.status)).toBe('ready');
    });

    it('rejects like the agent had rejected, while the agent loads', async () => {
      agent.check.mockImplementation(() => {
        throw failure;
      });
      const { context } = renderApp();

      await expect(context.check()).rejects.toBe(failure);
    });
  });

  describe('the timeout of a call', () => {
    const never = (): Promise<ShieldLabsAgent> => new Promise<ShieldLabsAgent>(() => undefined);

    it('also limits the wait for the agent to load, which goes on', async () => {
      loadMock.mockReturnValue(never());
      const { context } = renderApp();

      await expect(context.identify({ timeout: 20 })).rejects.toMatchObject({
        code: 'timeout',
        message: 'The ShieldLabs agent did not load within 20 ms.',
      });
      await expect(context.check({ userId: USER_HID, timeout: 20 })).rejects.toMatchObject({ code: 'timeout' });
      // The call gave up, the load did not: no error for the setup.
      expect(get(context.status)).toBe('loading');
      expect(get(context.error)).toBeNull();
      expect(agent.identify).not.toHaveBeenCalled();
      expect(agent.check).not.toHaveBeenCalled();
    });

    it('does not hand an agent that loads later to the call that gave up', async () => {
      const loading = deferred<ShieldLabsAgent>();
      loadMock.mockReturnValue(loading.promise);
      const { context } = renderApp();

      await expect(context.identify({ timeout: 20 })).rejects.toMatchObject({ code: 'timeout' });
      loading.resolve(agent);
      await settle();

      expect(get(context.status)).toBe('ready');
      expect(agent.identify).not.toHaveBeenCalled();
    });

    it('keeps its timeout error when the load fails after the call gave up', async () => {
      const loading = deferred<ShieldLabsAgent>();
      loadMock.mockReturnValue(loading.promise);
      const { context } = renderApp();

      await expect(context.identify({ timeout: 20 })).rejects.toMatchObject({ code: 'timeout' });
      const failure = new ShieldLabsError('load_failed', 'Blocked by a content blocker.');
      loading.reject(failure);
      await settle();

      expect(get(context.status)).toBe('error');
      expect(get(context.error)).toBe(failure);
    });

    it('covers the wait for the agent and its answer: the agent gets the time left', async () => {
      vi.useFakeTimers();
      const loading = deferred<ShieldLabsAgent>();
      loadMock.mockReturnValue(loading.promise);
      const { context } = renderApp();

      const identified = context.identify({ userId: USER_HID, timeout: 5000 });
      const checked = context.check();
      await vi.advanceTimersByTimeAsync(2000);
      loading.resolve(agent);

      await expect(identified).resolves.toMatchObject({ userId: USER_HID });
      await expect(checked).resolves.toMatchObject({ userId: null });
      expect(agent.identify).toHaveBeenCalledWith({ userId: USER_HID, timeout: 3000 });
      // Without a timeout of its own, a call has the setup timeout (10000 ms by default) in all.
      expect(agent.check).toHaveBeenCalledWith({ timeout: 8000 });
    });

    it('uses the setup timeout for calls without a timeout of their own', async () => {
      vi.useFakeTimers();
      const loading = deferred<ShieldLabsAgent>();
      loadMock.mockReturnValue(loading.promise);
      const { context } = renderApp({ publicKey: PUBLIC_KEY, timeout: 4000 });

      const identified = context.identify();
      await vi.advanceTimersByTimeAsync(1500);
      loading.resolve(agent);

      await expect(identified).resolves.toMatchObject({ userId: null });
      expect(agent.identify).toHaveBeenCalledWith({ timeout: 2500 });
    });

    it('ends the whole call at the setup timeout when the agent does not load', async () => {
      vi.useFakeTimers();
      sharedImport(loadMock);
      const { context } = renderApp({ publicKey: PUBLIC_KEY, timeout: 1000 });

      const identified = context.identify();
      const outcome = identified.catch((reason: unknown) => reason);
      await vi.advanceTimersByTimeAsync(999);
      expect(agent.identify).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(1);

      expect(await outcome).toMatchObject({
        code: 'timeout',
        message: 'The ShieldLabs agent did not load within 1000 ms.',
      });
      expect(get(context.status)).toBe('error');
    });

    it('ends with the load timeout when that comes first, even when the call has time left', async () => {
      vi.useFakeTimers();
      const imported = sharedImport(loadMock);
      const { context } = renderApp({ publicKey: PUBLIC_KEY, timeout: 1000 });

      const identified = context.identify({ timeout: 5000 }).catch((reason: unknown) => reason);
      await vi.advanceTimersByTimeAsync(1000);
      expect(get(context.status)).toBe('error');
      expect(await identified).toMatchObject({ code: 'timeout', message: 'The ShieldLabs agent did not load within 1000 ms.' });

      // The agent that arrives later makes the status ready, but is not handed to the call that ended.
      await vi.advanceTimersByTimeAsync(1500);
      imported.resolve(agent);
      await settle();
      expect(get(context.status)).toBe('ready');
      expect(agent.identify).not.toHaveBeenCalled();

      await expect(context.identify({ timeout: 5000 })).resolves.toMatchObject({ userId: null });
      expect(agent.identify).toHaveBeenCalledWith({ timeout: 5000 });
    });

    it('rejects without calling the agent when no time is left once it has loaded', async () => {
      vi.useFakeTimers();
      const loading = deferred<ShieldLabsAgent>();
      loadMock.mockReturnValue(loading.promise);
      const { context } = renderApp();

      const identified = context.identify({ timeout: 3000 });
      // The clock moves on, but the timer of the call has not run yet.
      vi.setSystemTime(Date.now() + 3000);
      loading.resolve(agent);

      await expect(identified).rejects.toMatchObject({
        code: 'timeout',
        message: 'The ShieldLabs agent did not load within 3000 ms.',
      });
      expect(agent.identify).not.toHaveBeenCalled();
    });

    it('never gives the agent more than the timeout, even when the clock was set back', async () => {
      vi.useFakeTimers();
      const loading = deferred<ShieldLabsAgent>();
      loadMock.mockReturnValue(loading.promise);
      const { context } = renderApp();

      const identified = context.identify({ timeout: 3000 });
      vi.setSystemTime(Date.now() - 60000);
      loading.resolve(agent);

      await identified;
      expect(agent.identify).toHaveBeenCalledWith({ timeout: 3000 });
    });

    it('lets the load finish when it is faster', async () => {
      const loading = deferred<ShieldLabsAgent>();
      loadMock.mockReturnValue(loading.promise);
      const { context } = renderApp();

      const identified = context.identify({ timeout: 60000 });
      loading.resolve(agent);

      await expect(identified).resolves.toMatchObject({ userId: null });
    });

    it('is left to the agent to refuse when @shieldlabs-ai/js would not accept it', async () => {
      const loading = deferred<ShieldLabsAgent>();
      loadMock.mockReturnValue(loading.promise);
      const { context } = renderApp();

      const identified = context.identify({ timeout: 0 });
      await new Promise((resolve) => setTimeout(resolve, 20));
      loading.resolve(agent);

      await expect(identified).resolves.toMatchObject({ userId: null });
      expect(agent.identify).toHaveBeenCalledWith({ timeout: 0 });
    });

    it('leaves options that are not an object to the agent to refuse', async () => {
      const loading = deferred<ShieldLabsAgent>();
      loadMock.mockReturnValue(loading.promise);
      const { context } = renderApp();

      const identified = context.identify(USER_HID as unknown as { userId: string });
      loading.resolve(agent);

      await identified;
      expect(agent.identify).toHaveBeenCalledWith(USER_HID);
    });
  });

  describe('autoLoad and load()', () => {
    it('autoLoad: false loads nothing until load() is called', async () => {
      const { context } = renderApp({ publicKey: PUBLIC_KEY, autoLoad: false });
      await settle();

      expect(loadMock).not.toHaveBeenCalled();
      expect(get(context.status)).toBe('loading');
      expect(get(context.error)).toBeNull();

      context.load();
      await settle();

      expect(loadMock).toHaveBeenCalledTimes(1);
      expect(loadMock).toHaveBeenCalledWith({ publicKey: PUBLIC_KEY });
      expect(get(context.status)).toBe('ready');
      expect(screen.getByTestId('status').textContent).toBe('ready');
    });

    it('autoLoad: true loads on mount', async () => {
      const { context } = renderApp({ publicKey: PUBLIC_KEY, autoLoad: true });
      await settle();

      expect(loadMock).toHaveBeenCalledTimes(1);
      expect(get(context.status)).toBe('ready');
    });

    it('any other autoLoad value waits for load(), as false does', async () => {
      renderApp({ publicKey: PUBLIC_KEY, autoLoad: 'false' as unknown as boolean });
      renderApp({ publicKey: PUBLIC_KEY, autoLoad: null as unknown as boolean });
      await settle();

      expect(loadMock).not.toHaveBeenCalled();
    });

    it('load() loads once, however often it is called', async () => {
      const loading = deferred<ShieldLabsAgent>();
      loadMock.mockReturnValue(loading.promise);
      const { context } = renderApp({ publicKey: PUBLIC_KEY, autoLoad: false });

      // It returns nothing: status and error report the load.
      const startLoading: () => unknown = context.load;
      expect(startLoading()).toBeUndefined();
      context.load();
      loading.resolve(agent);
      await settle();
      context.load();
      await settle();

      expect(loadMock).toHaveBeenCalledTimes(1);
      expect(get(context.status)).toBe('ready');
    });

    it('load() tries again after a failed load', async () => {
      loadMock.mockRejectedValueOnce(new ShieldLabsError('load_failed', 'Network error.'));
      const { context } = renderApp();
      await settle();
      expect(get(context.status)).toBe('error');

      context.load();
      expect(get(context.status)).toBe('loading');
      await settle();

      expect(loadMock).toHaveBeenCalledTimes(2);
      expect(get(context.status)).toBe('ready');
    });

    it('load() reports a failure through status and error only', async () => {
      const failure = new ShieldLabsError('load_failed', 'Blocked by a content blocker.');
      loadMock.mockRejectedValue(failure);
      const { context } = renderApp({ publicKey: PUBLIC_KEY, autoLoad: false });

      // Nothing to catch: an unhandled rejection would fail the test run.
      context.load();
      await settle();

      expect(get(context.status)).toBe('error');
      expect(get(context.error)).toBe(failure);
    });

    it('load() during initialisation starts loading, and the mount does not load again', async () => {
      render(SameComponent, { props: { options: { publicKey: PUBLIC_KEY, autoLoad: false }, loadEarly: true } });
      await settle();

      expect(loadMock).toHaveBeenCalledTimes(1);
      expect(screen.getByTestId('status').textContent).toBe('ready');
      // useIdentify({ runOnMount: true }) in the same component identified once.
      expect(screen.getByTestId('request-id').textContent).toMatch(/^9b1deb4d-/);
    });

    it('identify() before load() rejects at once with not_initialized, and check() resolves null', async () => {
      // With fake timers nothing can time out: the calls settle without waiting.
      vi.useFakeTimers();
      const { context } = renderApp({ publicKey: PUBLIC_KEY, autoLoad: false });

      const identified = context.identify({ userId: USER_HID, timeout: 60000 });
      await expect(identified).rejects.toBeInstanceOf(ShieldLabsError);
      await expect(identified).rejects.toMatchObject({
        code: 'not_initialized',
        message: 'The ShieldLabs agent is not loaded: setShieldLabs() has autoLoad: false and load() has not been called.',
      });
      await expect(context.check({ userId: USER_HID })).resolves.toBeNull();
      await expect(context.check()).resolves.toBeNull();

      // Nothing loads, and the setup has no error: it waits for load().
      expect(loadMock).not.toHaveBeenCalled();
      expect(get(context.status)).toBe('loading');
      expect(get(context.error)).toBeNull();
      expect(agent.identify).not.toHaveBeenCalled();
      expect(agent.check).not.toHaveBeenCalled();
    });

    it('a call before load() is not resumed by it, and calls after load() wait for the agent within their timeout', async () => {
      vi.useFakeTimers();
      const loading = deferred<ShieldLabsAgent>();
      loadMock.mockReturnValue(loading.promise);
      const { context } = renderApp({ publicKey: PUBLIC_KEY, autoLoad: false });

      const early = context.identify().catch((reason: unknown) => reason);
      context.load();
      const identified = context.identify({ userId: USER_HID });
      const checked = context.check({ timeout: 2000 });
      await vi.advanceTimersByTimeAsync(1000);
      loading.resolve(agent);

      expect(await early).toMatchObject({ code: 'not_initialized' });
      await expect(identified).resolves.toMatchObject({ userId: USER_HID });
      await expect(checked).resolves.toMatchObject({ userId: null });
      expect(agent.identify).toHaveBeenCalledTimes(1);
      expect(agent.identify).toHaveBeenCalledWith({ userId: USER_HID, timeout: 9000 });
      expect(agent.check).toHaveBeenCalledWith({ timeout: 1000 });
      expect(loadMock).toHaveBeenCalledTimes(1);
    });

    it('runs checkOnLoad once the agent loaded after load()', async () => {
      const { context } = renderApp({ publicKey: PUBLIC_KEY, autoLoad: false, checkOnLoad: true });
      await settle();
      expect(agent.check).not.toHaveBeenCalled();
      // A call that failed before load() does not hold back the check.
      await expect(context.identify()).rejects.toMatchObject({ code: 'not_initialized' });

      context.load();
      await settle();
      expect(agent.check).toHaveBeenCalledTimes(1);
      expect(agent.check).toHaveBeenCalledWith(undefined);
    });
  });

  describe('getAgent()', () => {
    it('resolves the loaded agent, the same object on every call', async () => {
      const { context } = renderApp();
      await settle();

      const first = await context.getAgent();
      const second = await context.getAgent();
      expect(first).toBe(agent);
      expect(second).toBe(first);
      expect(loadMock).toHaveBeenCalledTimes(1);
    });

    it('waits for the agent to load', async () => {
      const loading = deferred<ShieldLabsAgent>();
      loadMock.mockReturnValue(loading.promise);
      const { context } = renderApp();

      const found = context.getAgent();
      loading.resolve(agent);
      await expect(found).resolves.toBe(agent);
      expect(get(context.status)).toBe('ready');
    });

    it('rejects with the error of the load, and loads again on the next call', async () => {
      const failure = new ShieldLabsError('load_failed', 'Network error.');
      loadMock.mockRejectedValueOnce(failure);
      const { context } = renderApp();

      await expect(context.getAgent()).rejects.toBe(failure);
      await expect(context.getAgent()).resolves.toBe(agent);
      expect(loadMock).toHaveBeenCalledTimes(2);
      expect(get(context.status)).toBe('ready');
    });

    it('rejects with the load timeout, and the next call resolves the agent that arrived late', async () => {
      vi.useFakeTimers();
      const imported = sharedImport(loadMock);
      const { context } = renderApp({ publicKey: PUBLIC_KEY, timeout: 1000 });

      let outcome: unknown;
      void context.getAgent().then(
        () => {
          outcome = 'resolved';
        },
        (reason: unknown) => {
          outcome = reason;
        },
      );
      await vi.advanceTimersByTimeAsync(999);
      expect(outcome).toBeUndefined();
      await vi.advanceTimersByTimeAsync(1);
      // The same error as the setup reports: getAgent() does not wait for the running import.
      expect(outcome).toBeInstanceOf(ShieldLabsError);
      expect(outcome).toMatchObject({ code: 'timeout', message: 'The ShieldLabs agent did not load within 1000 ms.' });
      expect(outcome).toBe(get(context.error));

      imported.resolve(agent);
      await settle();
      expect(get(context.status)).toBe('ready');
      await expect(context.getAgent()).resolves.toBe(agent);
    });

    it('rejects with the load timeout, not with a later failure of the import that outlived it', async () => {
      vi.useFakeTimers();
      const imported = sharedImport(loadMock);
      const { context } = renderApp({ publicKey: PUBLIC_KEY, timeout: 1000 });

      const outcome = context.getAgent().catch((reason: unknown) => reason);
      await vi.advanceTimersByTimeAsync(1000);
      const failure = new ShieldLabsError('load_failed', 'Could not load the ShieldLabs agent.');
      imported.reject(failure);
      await settle();

      expect(await outcome).toMatchObject({ code: 'timeout', message: 'The ShieldLabs agent did not load within 1000 ms.' });
      expect(get(context.error)).toBe(failure);
      expect(get(context.status)).toBe('error');
    });

    it('has no timeout of its own while it waits for load() with autoLoad: false', async () => {
      vi.useFakeTimers();
      const { context } = renderApp({ publicKey: PUBLIC_KEY, autoLoad: false, timeout: 1000 });

      let outcome: 'resolved' | 'rejected' | undefined;
      void context.getAgent().then(
        () => {
          outcome = 'resolved';
        },
        () => {
          outcome = 'rejected';
        },
      );
      // Far beyond the setup timeout, and no timer runs for it.
      await vi.advanceTimersByTimeAsync(60000);
      expect(outcome).toBeUndefined();
      expect(vi.getTimerCount()).toBe(0);
      expect(loadMock).not.toHaveBeenCalled();

      context.load();
      await vi.advanceTimersByTimeAsync(0);
      expect(outcome).toBe('resolved');
      expect(loadMock).toHaveBeenCalledTimes(1);
      expect(get(context.status)).toBe('ready');
    });

    it('rejects with the error of a load that failed after load() with autoLoad: false', async () => {
      const failure = new ShieldLabsError('load_failed', 'Blocked by a content blocker.');
      loadMock.mockRejectedValue(failure);
      const { context } = renderApp({ publicKey: PUBLIC_KEY, autoLoad: false });

      const outcome = context.getAgent().catch((reason: unknown) => reason);
      context.load();

      expect(await outcome).toBe(failure);
      expect(get(context.status)).toBe('error');
    });

    it('is not an identification: it does not hold back checkOnLoad', async () => {
      const loading = deferred<ShieldLabsAgent>();
      loadMock.mockReturnValue(loading.promise);
      const { context } = renderApp({ publicKey: PUBLIC_KEY, checkOnLoad: true });

      const found = context.getAgent();
      loading.resolve(agent);
      await found;
      await settle();
      expect(agent.check).toHaveBeenCalledTimes(1);
    });
  });

  it('getShieldLabs() in a child returns the object that setShieldLabs() returned', () => {
    let fromRoot: ShieldLabsContext | undefined;
    let fromChild: ShieldLabsContext | undefined;
    render(App, {
      props: {
        options: { publicKey: PUBLIC_KEY },
        onsetup: (value: ShieldLabsContext) => {
          fromRoot = value;
        },
        onstatus: (value: ShieldLabsContext) => {
          fromChild = value;
        },
      },
    });

    expect(fromRoot).toBeDefined();
    expect(fromChild).toBe(fromRoot);
    expect(Object.keys(fromRoot ?? {}).sort()).toEqual(['check', 'error', 'getAgent', 'identify', 'load', 'status']);
  });

  it('gives every setShieldLabs() call its own state', async () => {
    const first = renderApp();
    loadMock.mockRejectedValueOnce(new ShieldLabsError('load_failed', 'Network error.'));
    const second = renderApp();
    await settle();

    expect(first.context).not.toBe(second.context);
    expect(get(first.context.status)).toBe('ready');
    expect(get(second.context.status)).toBe('error');
  });

  it('works when one component calls setShieldLabs(), getShieldLabs() and useIdentify()', async () => {
    render(SameComponent, { props: { options: { publicKey: PUBLIC_KEY } } });
    await settle();

    expect(screen.getByTestId('same').textContent).toBe('same');
    expect(screen.getByTestId('status').textContent).toBe('ready');
    expect(screen.getByTestId('request-id').textContent).toMatch(/^9b1deb4d-/);
  });

  it('works in components that do not use runes, with the plain options object', async () => {
    render(LegacyApp, { props: { options: { publicKey: PUBLIC_KEY } } });
    expect(screen.getByTestId('legacy-root-status').textContent).toBe('loading');
    await settle();

    expect(screen.getByTestId('legacy-root-status').textContent).toBe('ready');
    expect(screen.getByTestId('legacy-summary').textContent).toBe('ready idle');
  });

  it('getShieldLabs() throws a clear error without setShieldLabs() in a parent', () => {
    expect(() => render(Orphan, { props: { use: 'getShieldLabs' } })).toThrow(
      '[ShieldLabs] getShieldLabs() found no ShieldLabs setup. Call setShieldLabs() in a parent component (in SvelteKit, the root +layout.svelte).',
    );
  });

  describe('checkOnLoad', () => {
    it('does not check by default', async () => {
      renderApp();
      await settle();

      expect(agent.check).not.toHaveBeenCalled();
    });

    it('true runs one anonymous check() when the agent is ready', async () => {
      const loading = deferred<ShieldLabsAgent>();
      loadMock.mockReturnValue(loading.promise);
      const { context } = renderApp({ publicKey: PUBLIC_KEY, checkOnLoad: true });
      await settle();
      expect(agent.check).not.toHaveBeenCalled();

      loading.resolve(agent);
      await settle();
      expect(agent.check).toHaveBeenCalledTimes(1);
      expect(agent.check).toHaveBeenCalledWith(undefined);

      // Later calls do not check again.
      await context.identify();
      await settle();
      expect(agent.check).toHaveBeenCalledTimes(1);
    });

    it('is skipped when an identification for the same User HID waits for the agent', async () => {
      const loading = deferred<ShieldLabsAgent>();
      loadMock.mockReturnValue(loading.promise);
      render(App, {
        props: {
          options: { publicKey: PUBLIC_KEY, checkOnLoad: { userId: USER_HID } },
          showIdentify: true,
          identifyOptions: { runOnMount: true, userId: USER_HID },
        },
      });
      await settle();

      loading.resolve(agent);
      await settle();
      expect(agent.identify).toHaveBeenCalledTimes(1);
      // That identification covers the visit: the agent runs one per User HID at a time.
      expect(agent.check).not.toHaveBeenCalled();
    });

    it('is skipped when an anonymous call waits and the check is anonymous', async () => {
      const loading = deferred<ShieldLabsAgent>();
      loadMock.mockReturnValue(loading.promise);
      const { context } = renderApp({ publicKey: PUBLIC_KEY, checkOnLoad: true });

      const checked = context.check();
      loading.resolve(agent);
      await checked;
      await settle();
      // Only the check that was called, not a second one for checkOnLoad.
      expect(agent.check).toHaveBeenCalledTimes(1);
    });

    it('runs when the call that waits is for another User HID', async () => {
      const loading = deferred<ShieldLabsAgent>();
      loadMock.mockReturnValue(loading.promise);
      const { context } = renderApp({ publicKey: PUBLIC_KEY, checkOnLoad: { userId: USER_HID } });

      const identified = context.identify({ userId: OTHER_HID });
      loading.resolve(agent);
      await identified;
      await settle();
      expect(agent.check).toHaveBeenCalledTimes(1);
      expect(agent.check).toHaveBeenCalledWith({ userId: USER_HID });
    });

    it('runs when the call for the same User HID ended before the agent was ready', async () => {
      const loading = deferred<ShieldLabsAgent>();
      loadMock.mockReturnValue(loading.promise);
      const { context } = renderApp({ publicKey: PUBLIC_KEY, checkOnLoad: true });

      await expect(context.identify({ timeout: 10 })).rejects.toMatchObject({ code: 'timeout' });
      loading.resolve(agent);
      await settle();
      expect(agent.check).toHaveBeenCalledTimes(1);
    });

    it('{ userId } checks for the signed-in user', async () => {
      renderApp({ publicKey: PUBLIC_KEY, checkOnLoad: { userId: USER_HID } });
      await settle();

      expect(agent.check).toHaveBeenCalledTimes(1);
      expect(agent.check).toHaveBeenCalledWith({ userId: USER_HID });
    });

    it('{} checks anonymously', async () => {
      renderApp({ publicKey: PUBLIC_KEY, checkOnLoad: {} });
      await settle();

      expect(agent.check).toHaveBeenCalledWith({ userId: undefined });
    });

    it('false and other values do not check', async () => {
      renderApp({ publicKey: PUBLIC_KEY, checkOnLoad: false });
      renderApp({ publicKey: PUBLIC_KEY, checkOnLoad: 'yes' as unknown as boolean });
      await settle();

      expect(agent.check).not.toHaveBeenCalled();
    });

    it('ignores a check that did not run', async () => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
      agent.check.mockRejectedValue(new ShieldLabsError('timeout', 'The agent did not answer within 10000 ms.'));
      const { context } = renderApp({ publicKey: PUBLIC_KEY, checkOnLoad: true });
      await settle();

      expect(agent.check).toHaveBeenCalledTimes(1);
      expect(warn).not.toHaveBeenCalled();
      expect(get(context.status)).toBe('ready');
      expect(get(context.error)).toBeNull();
    });

    it('warns about an invalid checkOnLoad User HID', async () => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
      agent.check.mockRejectedValue(
        new ShieldLabsError('invalid_options', 'userId "anonymous" is reserved. Omit it for anonymous checks.'),
      );
      renderApp({ publicKey: PUBLIC_KEY, checkOnLoad: { userId: 'anonymous' } });
      await settle();

      expect(warn).toHaveBeenCalledWith(
        '[ShieldLabs] checkOnLoad: userId "anonymous" is reserved. Omit it for anonymous checks.',
      );
    });

    it('checks a User HID that is not a string, so that @shieldlabs-ai/js can refuse it', async () => {
      renderApp({ publicKey: PUBLIC_KEY, checkOnLoad: { userId: 42 as unknown as string } });
      await settle();

      expect(agent.check).toHaveBeenCalledWith({ userId: 42 });
    });

    it('does not check when the component is gone before the agent is ready', async () => {
      const loading = deferred<ShieldLabsAgent>();
      loadMock.mockReturnValue(loading.promise);
      const { view } = renderApp({ publicKey: PUBLIC_KEY, checkOnLoad: true });
      view.unmount();

      loading.resolve(agent);
      await settle();
      expect(agent.check).not.toHaveBeenCalled();
    });

    it('is skipped when the call that loads the agent after a failed load is for the same User HID', async () => {
      loadMock.mockRejectedValueOnce(new ShieldLabsError('load_failed', 'Network error.'));
      const { context } = renderApp({ publicKey: PUBLIC_KEY, checkOnLoad: true });
      await settle();

      await context.identify();
      await settle();
      expect(agent.check).not.toHaveBeenCalled();
    });

    it('checks once when a call for another User HID loads the agent after a failed load', async () => {
      loadMock.mockRejectedValueOnce(new ShieldLabsError('load_failed', 'Network error.'));
      const { context } = renderApp({ publicKey: PUBLIC_KEY, checkOnLoad: true });
      await settle();
      expect(agent.check).not.toHaveBeenCalled();

      await context.identify({ userId: USER_HID });
      await settle();
      expect(agent.check).toHaveBeenCalledTimes(1);
      expect(agent.check).toHaveBeenCalledWith(undefined);
    });
  });
});
