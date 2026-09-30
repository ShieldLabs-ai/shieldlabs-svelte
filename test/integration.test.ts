/**
 * The bindings with the real `@shieldlabs/js` loader. Only the hosted agent modules that the loader
 * imports from the CDN at runtime are replaced, by stand-ins with the agent's callback contract.
 *
 * The loader memoizes each import for the whole file, so the tests compare counts with the values
 * from before the test instead of assuming a fresh page: they pass in any order.
 */
import { fireEvent, render, screen } from '@testing-library/svelte';
import { get } from 'svelte/store';
import { describe, expect, it, vi } from 'vitest';
import type {
  IdentifyHelper,
  IdentifyOptions,
  IdentifyResult,
  ShieldLabsAgent,
  ShieldLabsContext,
  ShieldLabsOptions,
  ShieldLabsStatus,
  UseIdentifyOptions,
} from '../src/lib/index.js';
import App from './components/App.svelte';
import EarlyApp from './components/EarlyApp.svelte';
import { PUBLIC_KEY, settle, USER_HID } from './support/fake-agent.js';
import type { HostedAgentCall } from './support/hosted-agent.js';

/** Public Keys of domains whose agent module arrives only when a test lets it. */
const SLOW_PUBLIC_KEY = 'fedcba9876543210fedcba9876543210';
const LATE_PUBLIC_KEY = '00112233445566778899aabbccddeeff';
const LATER_PUBLIC_KEY = '8899aabbccddeeff0011223344556677';
/** Public Key of a domain whose agent module is only imported by the autoLoad test. */
const DEFERRED_PUBLIC_KEY = '4455667788990011aabbccddeeff2233';

const hosted = vi.hoisted(() => {
  /** An agent module that arrives when `arrive()` is called. */
  const delayed = () => {
    let arrive = (): void => undefined;
    const arrival = new Promise<void>((resolve) => {
      arrive = resolve;
    });
    return {
      imports: 0,
      calls: [] as HostedAgentCall[],
      arrival,
      arrive: (): void => {
        arrive();
      },
    };
  };
  return {
    imports: 0,
    calls: [] as HostedAgentCall[],
    slow: delayed(),
    late: delayed(),
    later: delayed(),
    deferred: { imports: 0, calls: [] as HostedAgentCall[] },
  };
});

vi.mock('https://cdn.shieldlabs.ai/snippet.js?publicKey=0123456789abcdef0123456789abcdef', async () => {
  hosted.imports += 1;
  const { createHostedAgent } = await import('./support/hosted-agent.js');
  return createHostedAgent(hosted.calls).module;
});

vi.mock('https://cdn.shieldlabs.ai/snippet.js?publicKey=fedcba9876543210fedcba9876543210', async () => {
  hosted.slow.imports += 1;
  await hosted.slow.arrival;
  const { createHostedAgent } = await import('./support/hosted-agent.js');
  return createHostedAgent(hosted.slow.calls).module;
});

vi.mock('https://cdn.shieldlabs.ai/snippet.js?publicKey=00112233445566778899aabbccddeeff', async () => {
  hosted.late.imports += 1;
  await hosted.late.arrival;
  const { createHostedAgent } = await import('./support/hosted-agent.js');
  return createHostedAgent(hosted.late.calls).module;
});

vi.mock('https://cdn.shieldlabs.ai/snippet.js?publicKey=8899aabbccddeeff0011223344556677', async () => {
  hosted.later.imports += 1;
  await hosted.later.arrival;
  const { createHostedAgent } = await import('./support/hosted-agent.js');
  return createHostedAgent(hosted.later.calls).module;
});

vi.mock('https://cdn.shieldlabs.ai/snippet.js?publicKey=4455667788990011aabbccddeeff2233', async () => {
  hosted.deferred.imports += 1;
  const { createHostedAgent } = await import('./support/hosted-agent.js');
  return createHostedAgent(hosted.deferred.calls).module;
});

function renderApp(options: ShieldLabsOptions, identifyOptions?: UseIdentifyOptions) {
  let context: ShieldLabsContext | undefined;
  let helper: IdentifyHelper | undefined;
  const view = render(App, {
    props: {
      options,
      showIdentify: true,
      identifyOptions,
      onsetup: (value: ShieldLabsContext) => {
        context = value;
      },
      onhelper: (value: IdentifyHelper) => {
        helper = value;
      },
    },
  });
  if (!context || !helper) throw new Error('The test app did not set up');
  return { view, context, helper };
}

describe('with the real @shieldlabs/js loader', () => {
  it('rejects an invalid Public Key before importing anything, and says so in the console once', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const before = hosted.imports;
    const { context, helper } = renderApp({ publicKey: 'not a key' });
    await settle();

    expect(get(context.status)).toBe('error');
    expect(get(context.error)).toMatchObject({ code: 'invalid_options' });
    await expect(helper.identify()).resolves.toBeNull();
    expect(get(helper.error)).toMatchObject({ code: 'invalid_options' });
    expect(hosted.imports).toBe(before);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledWith(
      '[ShieldLabs] setShieldLabs() could not load the agent: publicKey must match ^[A-Za-z0-9_-]{1,128}$ (the Public Key of your domain).',
    );
  });

  it('reports a missing options object as invalid_options', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const before = hosted.imports;
    const { context } = renderApp(undefined as unknown as ShieldLabsOptions);
    await settle();

    expect(get(context.error)).toMatchObject({ code: 'invalid_options' });
    expect(hosted.imports).toBe(before);
    expect(warn).toHaveBeenCalledWith('[ShieldLabs] setShieldLabs() could not load the agent: load() needs an options object.');
  });

  it('loads the agent once for several mounts and remounts', async () => {
    const first = renderApp({ publicKey: PUBLIC_KEY });
    const second = renderApp({ publicKey: PUBLIC_KEY });
    await vi.waitFor(() => {
      expect(get(first.context.status)).toBe('ready');
    });
    first.view.unmount();
    const third = renderApp({ publicKey: PUBLIC_KEY });
    await settle();

    expect(get(first.context.status)).toBe('ready');
    expect(get(second.context.status)).toBe('ready');
    expect(get(third.context.status)).toBe('ready');
    expect(screen.getAllByTestId('status').map((node) => node.textContent)).toEqual(['ready', 'ready']);
    // One import for the whole file, whichever test loaded the agent first.
    expect(hosted.imports).toBe(1);
  });

  it('identifies through the agent force call and returns only the request ID and User HID', async () => {
    const { helper } = renderApp({ publicKey: PUBLIC_KEY });
    const before = hosted.calls.length;

    const anonymous = await helper.identify();
    const signedIn = await helper.identify({ userId: USER_HID });

    expect(anonymous).toEqual({ requestId: expect.stringMatching(/^2c5ea4c0-/) as unknown, userId: null });
    expect(signedIn).toEqual({ requestId: expect.stringMatching(/^2c5ea4c0-/) as unknown, userId: USER_HID });
    expect(anonymous?.requestId).not.toBe(signedIn?.requestId);
    expect(Object.keys(signedIn ?? {}).sort()).toEqual(['requestId', 'userId']);
    expect(hosted.calls.slice(before)).toEqual([
      { name: 'forceCheckAnonymous' },
      { name: 'forceCheckAuthenticatedUser', userHid: USER_HID },
    ]);
    expect(hosted.imports).toBe(1);
  });

  it('runs runOnMount and skips checkOnLoad for the same User HID', async () => {
    const before = hosted.calls.length;
    renderApp({ publicKey: PUBLIC_KEY, checkOnLoad: { userId: USER_HID } }, { runOnMount: true, userId: USER_HID });
    await vi.waitFor(() => {
      expect(screen.getAllByTestId('request-id').at(-1)?.textContent).toMatch(/^2c5ea4c0-/);
    });
    await settle();

    // The identification covers the visit: no background check competes with it.
    expect(hosted.calls.slice(before)).toEqual([{ name: 'forceCheckAuthenticatedUser', userHid: USER_HID }]);
  });

  it('runs checkOnLoad next to runOnMount for another User HID, with the agent limiting the background check', async () => {
    const before = hosted.calls.length;
    const { context } = renderApp({ publicKey: PUBLIC_KEY, checkOnLoad: true }, { runOnMount: true, userId: USER_HID });
    await vi.waitFor(() => {
      expect(hosted.calls.length - before).toBe(2);
    });
    await settle();

    const names = hosted.calls.slice(before).map((call) => call.name);
    expect(names.sort()).toEqual(['checkAnonymous', 'forceCheckAuthenticatedUser']);
    expect(screen.getAllByTestId('request-id').at(-1)?.textContent).toMatch(/^2c5ea4c0-/);

    // A second background check inside the five-minute window is skipped by the agent.
    await expect(context.check()).resolves.toBeNull();
  });

  it('passes a reserved User HID to the loader, which refuses it', async () => {
    const { helper } = renderApp({ publicKey: PUBLIC_KEY });
    const before = hosted.calls.length;

    await expect(helper.identify({ userId: 'anonymous' })).resolves.toBeNull();
    expect(get(helper.error)).toMatchObject({ code: 'invalid_options' });
    expect(hosted.calls.length).toBe(before);
  });

  it('lets the loader refuse options that are not an object instead of identifying anonymously', async () => {
    const { helper } = renderApp({ publicKey: PUBLIC_KEY });
    const bare = renderApp({ publicKey: PUBLIC_KEY }, USER_HID as unknown as UseIdentifyOptions);
    await vi.waitFor(() => {
      expect(get(bare.context.status)).toBe('ready');
    });
    const before = hosted.calls.length;

    await expect(helper.identify(USER_HID as unknown as IdentifyOptions)).resolves.toBeNull();
    expect(get(helper.error)).toMatchObject({ code: 'invalid_options' });
    await expect(bare.helper.identify()).resolves.toBeNull();
    expect(get(bare.helper.error)).toMatchObject({ code: 'invalid_options' });
    expect(hosted.calls.length).toBe(before);
  });

  it('becomes ready and runs checkOnLoad when the agent arrives after the load timeout', async () => {
    const { context } = renderApp({ publicKey: SLOW_PUBLIC_KEY, timeout: 50, checkOnLoad: true });
    const statuses: ShieldLabsStatus[] = [];
    const errors: (string | null)[] = [];
    context.status.subscribe((value) => statuses.push(value));
    context.error.subscribe((value) => errors.push(value?.code ?? null));

    // Well past the load timeout (a loader that times out reports it in the meantime).
    await new Promise((resolve) => setTimeout(resolve, 150));
    expect(hosted.slow.imports).toBe(1);
    if (get(context.status) === 'error') expect(get(context.error)).toMatchObject({ code: 'timeout' });
    else expect(get(context.status)).toBe('loading');

    hosted.slow.arrive();
    await vi.waitFor(() => {
      expect(get(context.status)).toBe('ready');
    });
    await vi.waitFor(() => {
      expect(hosted.slow.calls).toEqual([{ name: 'checkAnonymous' }]);
    });

    expect(get(context.error)).toBeNull();
    expect(screen.getByTestId('root-status').textContent).toBe('ready');
    // The agent arrived through the import that was already running: never back to 'loading'.
    expect(statuses[0]).toBe('loading');
    expect(statuses.at(-1)).toBe('ready');
    expect(statuses.filter((value) => value === 'loading')).toHaveLength(1);
    expect(errors.filter((code) => code !== null && code !== 'timeout')).toEqual([]);
    expect(hosted.slow.imports).toBe(1);
  });

  it('ends runOnMount with the load timeout, does not run it when the agent arrives, and limits a call by its timeout', async () => {
    const { context, helper } = renderApp(
      { publicKey: LATE_PUBLIC_KEY, timeout: 50 },
      { runOnMount: true, userId: USER_HID },
    );

    // A call with its own shorter timeout gives up waiting for the agent before the setup does.
    await expect(context.identify({ timeout: 10 })).rejects.toMatchObject({
      code: 'timeout',
      message: 'The ShieldLabs agent did not load within 10 ms.',
    });

    // After the load timeout, the mount identification ends with it.
    await vi.waitFor(() => {
      expect(get(helper.error)).toMatchObject({ code: 'timeout', message: 'The ShieldLabs agent did not load within 50 ms.' });
    });
    expect(get(helper.isLoading)).toBe(false);
    expect(hosted.late.calls).toEqual([]);

    hosted.late.arrive();
    await vi.waitFor(() => {
      expect(get(context.status)).toBe('ready');
    });
    await settle();
    // The agent is ready for the next call, and the mount identification does not run again.
    expect(hosted.late.calls).toEqual([]);
    expect(get(helper.result)).toBeNull();
    expect(get(helper.error)).toMatchObject({ code: 'timeout' });

    await expect(helper.identify()).resolves.toMatchObject({ userId: USER_HID });
    expect(hosted.late.calls).toEqual([{ name: 'forceCheckAuthenticatedUser', userHid: USER_HID }]);
    expect(hosted.late.imports).toBe(1);
  });
  it('autoLoad: false imports nothing until load(): calls fail at once, getAgent() waits for it', async () => {
    const { context, helper } = renderApp({ publicKey: DEFERRED_PUBLIC_KEY, autoLoad: false });

    await expect(helper.identify()).resolves.toBeNull();
    expect(get(helper.error)).toMatchObject({ code: 'not_initialized' });
    expect(get(helper.isLoading)).toBe(false);
    await expect(context.identify()).rejects.toMatchObject({ code: 'not_initialized' });
    await expect(context.check()).resolves.toBeNull();
    let agent: ShieldLabsAgent | undefined;
    const found = context.getAgent().then((value) => {
      agent = value;
      return value;
    });
    await new Promise((resolve) => setTimeout(resolve, 30));

    expect(agent).toBeUndefined();
    expect(hosted.deferred.imports).toBe(0);
    expect(hosted.deferred.calls).toEqual([]);
    expect(get(context.status)).toBe('loading');

    context.load();
    expect(await found).toBe(agent);
    await expect(helper.identify()).resolves.toEqual({
      requestId: expect.stringMatching(/^2c5ea4c0-/) as unknown,
      userId: null,
    });
    expect(get(helper.error)).toBeNull();
    expect(get(context.status)).toBe('ready');
    expect(hosted.deferred.imports).toBe(1);
    expect(hosted.deferred.calls).toEqual([{ name: 'forceCheckAnonymous' }]);
  });

  it('ends a call and getAgent() with the load timeout, also when the call has time left, and then uses the late agent', async () => {
    const { context } = renderApp({ publicKey: LATER_PUBLIC_KEY, timeout: 30 });
    const identified = context.identify({ timeout: 5000 });
    const found = context.getAgent();
    await expect(identified).rejects.toMatchObject({
      code: 'timeout',
      message: 'The ShieldLabs agent did not load within 30 ms.',
    });
    await expect(found).rejects.toMatchObject({ code: 'timeout', message: 'The ShieldLabs agent did not load within 30 ms.' });
    expect(get(context.error)).toMatchObject({ code: 'timeout' });

    hosted.later.arrive();
    await vi.waitFor(() => {
      expect(get(context.status)).toBe('ready');
    });
    // The calls that ended never reach the agent. The next ones get it at once.
    expect(hosted.later.calls).toEqual([]);
    await expect(context.getAgent()).resolves.toBeDefined();
    await expect(context.identify()).resolves.toEqual({
      requestId: expect.stringMatching(/^2c5ea4c0-/) as unknown,
      userId: null,
    });
    expect(hosted.later.calls).toEqual([{ name: 'forceCheckAnonymous' }]);
    expect(hosted.later.imports).toBe(1);
  });

  it('getAgent() gives identifyOnInteraction() the agent: the first interaction starts the identification', async () => {
    let context: ShieldLabsContext | undefined;
    const submitted: (IdentifyResult | null)[] = [];
    const view = render(EarlyApp, {
      props: {
        options: { publicKey: PUBLIC_KEY },
        onsetup: (value: ShieldLabsContext) => {
          context = value;
        },
        onsubmitted: (value: IdentifyResult | null) => {
          submitted.push(value);
        },
      },
    });
    await vi.waitFor(() => {
      expect(context && get(context.status)).toBe('ready');
    });
    await settle();
    const form = view.container.querySelector('form')!;
    const input = screen.getByRole('textbox', { name: 'Email' });
    const before = hosted.calls.length;

    await fireEvent.focusIn(input);
    await vi.waitFor(() => {
      expect(hosted.calls.length - before).toBe(1);
    });
    expect(hosted.calls.at(-1)).toEqual({ name: 'forceCheckAnonymous' });

    // The submission takes the identification that the interaction started: none is added.
    await fireEvent.submit(form);
    await vi.waitFor(() => {
      expect(submitted).toHaveLength(1);
    });
    expect(submitted[0]).toEqual({ requestId: expect.stringMatching(/^2c5ea4c0-/) as unknown, userId: null });
    expect(hosted.calls.length - before).toBe(1);

    // The next submission without a new interaction gets a new identification.
    await fireEvent.submit(form);
    await vi.waitFor(() => {
      expect(submitted).toHaveLength(2);
    });
    expect(submitted[1]?.requestId).not.toBe(submitted[0]?.requestId);
    expect(hosted.calls.length - before).toBe(2);

    // Once the form is gone, its listeners are removed.
    await view.rerender({ showForm: false });
    await settle();
    await fireEvent.focusIn(input);
    await settle();
    expect(hosted.calls.length - before).toBe(2);
  });

  it('with autoLoad: false, a submission before load() goes out at once, and load() arms the form', async () => {
    let context: ShieldLabsContext | undefined;
    const submitted: (IdentifyResult | null)[] = [];
    const view = render(EarlyApp, {
      props: {
        options: { publicKey: PUBLIC_KEY, autoLoad: false },
        onsetup: (value: ShieldLabsContext) => {
          context = value;
        },
        onsubmitted: (value: IdentifyResult | null) => {
          submitted.push(value);
        },
      },
    });
    await settle();
    const form = view.container.querySelector('form')!;
    const input = screen.getByRole('textbox', { name: 'Email' });
    const before = hosted.calls.length;

    // No consent yet: the submission does not wait for the agent and carries no request ID.
    await fireEvent.focusIn(input);
    await fireEvent.submit(form);
    await vi.waitFor(() => {
      expect(submitted).toEqual([null]);
    });
    expect(hosted.calls.length).toBe(before);

    context!.load();
    await vi.waitFor(() => {
      expect(get(context!.status)).toBe('ready');
    });
    await settle();
    await fireEvent.focusIn(input);
    await vi.waitFor(() => {
      expect(hosted.calls.length - before).toBe(1);
    });
    await fireEvent.submit(form);
    await vi.waitFor(() => {
      expect(submitted).toHaveLength(2);
    });
    expect(submitted[1]).toEqual({ requestId: expect.stringMatching(/^2c5ea4c0-/) as unknown, userId: null });
    expect(hosted.calls.length - before).toBe(1);
  });
});
