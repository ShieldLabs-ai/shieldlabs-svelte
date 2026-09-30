import { load, ShieldLabsError, type IdentifyOptions, type IdentifyResult, type ShieldLabsAgent } from '@shieldlabs/js';
import { fireEvent, render, screen } from '@testing-library/svelte';
import { get } from 'svelte/store';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { IdentifyHelper, ShieldLabsContext, ShieldLabsOptions, UseIdentifyOptions } from '../src/lib/index.js';
import App from './components/App.svelte';
import ConsentApp from './components/ConsentApp.svelte';
import LegacyApp from './components/LegacyApp.svelte';
import Orphan from './components/Orphan.svelte';
import TwoForms from './components/TwoForms.svelte';
import {
  createFakeAgent,
  deferred,
  OTHER_HID,
  PUBLIC_KEY,
  settle,
  sharedImport,
  USER_HID,
  type FakeAgent,
} from './support/fake-agent.js';

vi.mock('@shieldlabs/js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@shieldlabs/js')>();
  return { ...actual, load: vi.fn() };
});

const loadMock = vi.mocked(load);

function renderHelper(
  identifyOptions?: UseIdentifyOptions,
  options: ShieldLabsOptions = { publicKey: PUBLIC_KEY },
  onsetup?: (context: ShieldLabsContext) => void,
) {
  let helper: IdentifyHelper | undefined;
  const view = render(App, {
    props: {
      options,
      showIdentify: true,
      identifyOptions,
      onsetup,
      onhelper: (value: IdentifyHelper) => {
        helper = value;
      },
    },
  });
  if (!helper) throw new Error('useIdentify() did not run');
  return { view, helper };
}

const text = (testId: string): string | null => screen.getByTestId(testId).textContent;

function result(requestId: string, userId: string | null = null): IdentifyResult {
  return { requestId, userId };
}

describe('useIdentify()', () => {
  let agent: FakeAgent;

  beforeEach(() => {
    agent = createFakeAgent();
    loadMock.mockReset();
    loadMock.mockResolvedValue(agent);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('starts empty and does not identify on mount', async () => {
    const { helper } = renderHelper();
    await settle();

    expect(get(helper.result)).toBeNull();
    expect(get(helper.isLoading)).toBe(false);
    expect(get(helper.error)).toBeNull();
    expect(agent.identify).not.toHaveBeenCalled();
    expect(text('loading')).toBe('no');
  });

  it('identify() sets isLoading, then the result', async () => {
    const answer = deferred<IdentifyResult>();
    agent.identify.mockReturnValueOnce(answer.promise);
    const { helper } = renderHelper();
    await settle();

    const identified = helper.identify();
    await settle();
    expect(text('loading')).toBe('yes');
    expect(screen.getByRole('button').hasAttribute('disabled')).toBe(true);
    expect(text('request-id')).toBe('');

    answer.resolve(result('6f1c2d3e-4b5a-4c6d-8e7f-0a1b2c3d4e5f'));
    await expect(identified).resolves.toEqual(result('6f1c2d3e-4b5a-4c6d-8e7f-0a1b2c3d4e5f'));
    await settle();
    expect(text('loading')).toBe('no');
    expect(text('request-id')).toBe('6f1c2d3e-4b5a-4c6d-8e7f-0a1b2c3d4e5f');
    expect(screen.getByRole('button').hasAttribute('disabled')).toBe(false);
    expect(get(helper.error)).toBeNull();
  });

  it('identifies when the button is clicked', async () => {
    renderHelper();
    await settle();

    await fireEvent.click(screen.getByRole('button'));
    await settle();

    expect(agent.identify).toHaveBeenCalledTimes(1);
    expect(text('request-id')).toMatch(/^9b1deb4d-/);
  });

  it('waits for the agent to load', async () => {
    const loading = deferred<ShieldLabsAgent>();
    loadMock.mockReturnValue(loading.promise);
    const { helper } = renderHelper();

    const identified = helper.identify();
    await settle();
    expect(get(helper.isLoading)).toBe(true);
    expect(agent.identify).not.toHaveBeenCalled();

    loading.resolve(agent);
    await expect(identified).resolves.toMatchObject({ userId: null });
    expect(get(helper.isLoading)).toBe(false);
  });

  it('resolves null and sets error when the identification fails', async () => {
    const failure = new ShieldLabsError('timeout', 'The agent did not answer within 10000 ms.');
    agent.identify.mockRejectedValueOnce(failure);
    const { helper } = renderHelper();

    await expect(helper.identify()).resolves.toBeNull();
    await settle();

    expect(get(helper.error)).toBe(failure);
    expect(get(helper.result)).toBeNull();
    expect(get(helper.isLoading)).toBe(false);
    expect(text('identify-error')).toBe('timeout');
  });

  it('reports a failed load as the error of the identification', async () => {
    const failure = new ShieldLabsError('load_failed', 'Blocked by a content blocker.');
    loadMock.mockRejectedValue(failure);
    const { helper } = renderHelper();

    await expect(helper.identify()).resolves.toBeNull();
    expect(get(helper.error)).toBe(failure);
    expect(agent.identify).not.toHaveBeenCalled();
  });

  it('gives up waiting for the agent after the timeout of the call', async () => {
    loadMock.mockReturnValue(new Promise<ShieldLabsAgent>(() => undefined));
    const { helper } = renderHelper({ timeout: 20 });

    await expect(helper.identify()).resolves.toBeNull();
    expect(get(helper.error)).toMatchObject({ code: 'timeout', message: 'The ShieldLabs agent did not load within 20 ms.' });
    expect(get(helper.isLoading)).toBe(false);
    expect(agent.identify).not.toHaveBeenCalled();
  });

  it('wraps an unexpected failure in a ShieldLabsError', async () => {
    const failure = new Error('agent crashed');
    agent.identify.mockRejectedValueOnce(failure);
    const { helper } = renderHelper();

    await expect(helper.identify()).resolves.toBeNull();
    expect(get(helper.error)).toMatchObject({ code: 'not_initialized', message: 'agent crashed', cause: failure });
    expect(get(helper.error)).toBeInstanceOf(ShieldLabsError);
  });

  it('a new identification clears the previous result and error', async () => {
    agent.identify.mockRejectedValueOnce(new ShieldLabsError('not_initialized', 'Not started.'));
    const answer = deferred<IdentifyResult>();
    agent.identify.mockReturnValueOnce(answer.promise);
    const { helper } = renderHelper();

    await helper.identify();
    expect(get(helper.error)).not.toBeNull();

    const second = helper.identify();
    expect(get(helper.error)).toBeNull();
    expect(get(helper.result)).toBeNull();
    expect(get(helper.isLoading)).toBe(true);

    answer.resolve(result('0d9c8b7a-6f5e-4d3c-9b2a-1f0e9d8c7b6a'));
    await second;
    expect(get(helper.result)).toEqual(result('0d9c8b7a-6f5e-4d3c-9b2a-1f0e9d8c7b6a'));
  });

  describe('options', () => {
    it('passes the helper options to the agent', async () => {
      const { helper } = renderHelper({ userId: USER_HID, timeout: 4000 });
      await settle();

      await expect(helper.identify()).resolves.toMatchObject({ userId: USER_HID });
      expect(agent.identify).toHaveBeenCalledWith({ userId: USER_HID, timeout: 4000 });
    });

    it('call options override the helper options', async () => {
      const { helper } = renderHelper({ userId: USER_HID, timeout: 4000 });
      await settle();

      await helper.identify({ timeout: 1500 });
      expect(agent.identify).toHaveBeenLastCalledWith({ userId: USER_HID, timeout: 1500 });

      await helper.identify({ userId: OTHER_HID });
      expect(agent.identify).toHaveBeenLastCalledWith({ userId: OTHER_HID, timeout: 4000 });

      // A userId key overrides the helper's User HID whatever its value: undefined and null (plain
      // JavaScript) both identify anonymously.
      await expect(helper.identify({ userId: undefined })).resolves.toMatchObject({ userId: null });
      expect(agent.identify).toHaveBeenLastCalledWith({ userId: undefined, timeout: 4000 });

      await expect(helper.identify({ userId: null as unknown as string })).resolves.toMatchObject({ userId: null });
      expect(agent.identify).toHaveBeenLastCalledWith({ userId: null, timeout: 4000 });

      // Only options without the key use the helper's User HID.
      await expect(helper.identify({})).resolves.toMatchObject({ userId: USER_HID });
      expect(agent.identify).toHaveBeenLastCalledWith({ userId: USER_HID, timeout: 4000 });
    });

    it('passes call options that are not an object to the agent unchanged, so that it can reject them', async () => {
      const { helper } = renderHelper({ userId: USER_HID });
      await settle();

      // For example identify(hid) instead of identify({ userId: hid }) in plain JavaScript.
      await helper.identify(OTHER_HID as unknown as IdentifyOptions);
      expect(agent.identify).toHaveBeenLastCalledWith(OTHER_HID);

      // null counts as no call options, as in @shieldlabs/js.
      await helper.identify(null as unknown as IdentifyOptions);
      expect(agent.identify).toHaveBeenLastCalledWith({ userId: USER_HID });
    });

    it('passes helper options that are not an object to the agent unchanged', async () => {
      const { helper } = renderHelper(USER_HID as unknown as UseIdentifyOptions);
      await settle();

      await helper.identify();
      expect(agent.identify).toHaveBeenLastCalledWith(USER_HID);
      await helper.identify({ userId: OTHER_HID });
      expect(agent.identify).toHaveBeenLastCalledWith(USER_HID);
      expect(agent.identify).toHaveBeenCalledTimes(2);
    });

    it('never passes runOnMount to the agent', async () => {
      const { helper } = renderHelper({ userId: USER_HID, runOnMount: false });
      await settle();

      await helper.identify();
      expect(agent.identify).toHaveBeenCalledWith({ userId: USER_HID });
    });

    it('reads options given as a function when an identification starts', async () => {
      const { view, helper } = renderHelper({ userId: USER_HID });
      await settle();
      await helper.identify();
      expect(agent.identify).toHaveBeenLastCalledWith({ userId: USER_HID });

      // IdentifyButton passes `() => options`: a changed prop is used by the next call.
      await view.rerender({ identifyOptions: { userId: OTHER_HID } });
      await helper.identify();
      expect(agent.identify).toHaveBeenLastCalledWith({ userId: OTHER_HID });
    });
  });

  describe('concurrent calls', () => {
    it('shares a running identification with the same User HID and timeout (double submit)', async () => {
      const answer = deferred<IdentifyResult>();
      agent.identify.mockReturnValueOnce(answer.promise);
      const { helper } = renderHelper({ userId: USER_HID });

      const first = helper.identify();
      const second = helper.identify();
      const third = helper.identify({ userId: USER_HID });
      expect(second).toBe(first);
      expect(third).toBe(first);

      answer.resolve(result('5a4b3c2d-1e0f-4a9b-8c7d-6e5f4a3b2c1d', USER_HID));
      await expect(first).resolves.toEqual(result('5a4b3c2d-1e0f-4a9b-8c7d-6e5f4a3b2c1d', USER_HID));
      expect(agent.identify).toHaveBeenCalledTimes(1);

      // Once it finished, the next call starts a new identification.
      await helper.identify();
      expect(agent.identify).toHaveBeenCalledTimes(2);
    });

    it('shares a running identification with the same timeout, and starts another for a different one', async () => {
      const { helper } = renderHelper({ userId: USER_HID });
      await settle();
      const answer = deferred<IdentifyResult>();
      agent.identify.mockReturnValueOnce(answer.promise);

      const first = helper.identify({ timeout: 2000 });
      expect(helper.identify({ timeout: 2000 })).toBe(first);
      const other = helper.identify({ timeout: 3000 });
      const withoutTimeout = helper.identify();
      expect(other).not.toBe(first);
      expect(withoutTimeout).not.toBe(other);

      answer.resolve(result('1f2e3d4c-5b6a-4798-8a9b-0c1d2e3f4a5b', USER_HID));
      await Promise.all([first, other, withoutTimeout]);
      expect(agent.identify).toHaveBeenCalledTimes(3);
      expect(agent.identify.mock.calls.map(([options]) => options)).toEqual([
        { userId: USER_HID, timeout: 2000 },
        { userId: USER_HID, timeout: 3000 },
        { userId: USER_HID },
      ]);
    });

    it('compares the options after merging: a timeout from useIdentify() counts like one from the call', async () => {
      const answer = deferred<IdentifyResult>();
      agent.identify.mockReturnValueOnce(answer.promise);
      const { helper } = renderHelper({ timeout: 4000 });

      const first = helper.identify();
      expect(helper.identify({ timeout: 4000 })).toBe(first);
      expect(helper.identify({ timeout: 5000 })).not.toBe(first);
      answer.resolve(result('2a3b4c5d-6e7f-4819-9a0b-1c2d3e4f5a6b'));
      await first;
    });

    it('counts a call without a timeout with the default of 10000 ms', async () => {
      const { helper } = renderHelper({ userId: USER_HID });
      await settle();
      const answer = deferred<IdentifyResult>();
      agent.identify.mockReturnValueOnce(answer.promise);

      const first = helper.identify();
      expect(helper.identify({ timeout: 10000 })).toBe(first);
      expect(helper.identify({ userId: USER_HID, timeout: 10000 })).toBe(first);
      answer.resolve(result('3b4c5d6e-7f80-4912-8a3b-4c5d6e7f8091', USER_HID));
      await expect(first).resolves.toEqual(result('3b4c5d6e-7f80-4912-8a3b-4c5d6e7f8091', USER_HID));
      expect(agent.identify).toHaveBeenCalledTimes(1);
      expect(agent.identify).toHaveBeenCalledWith({ userId: USER_HID });
    });

    it('counts a call without a timeout with the setup timeout', async () => {
      const { helper } = renderHelper(undefined, { publicKey: PUBLIC_KEY, timeout: 4000 });
      await settle();
      const answer = deferred<IdentifyResult>();
      agent.identify.mockReturnValueOnce(answer.promise);

      const first = helper.identify();
      expect(helper.identify({ timeout: 4000 })).toBe(first);
      // 10000 ms is not the timeout this setup gives a call, so it is another identification.
      const other = helper.identify({ timeout: 10000 });
      expect(other).not.toBe(first);
      answer.resolve(result('4c5d6e7f-8091-4a23-9b4c-5d6e7f8091a2'));
      await Promise.all([first, other]);
      expect(agent.identify).toHaveBeenCalledTimes(2);
    });

    it('never shares a run with a timeout that @shieldlabs/js refuses', async () => {
      const answer = deferred<IdentifyResult>();
      agent.identify.mockReturnValueOnce(answer.promise);
      const { helper } = renderHelper();
      await settle();

      const first = helper.identify();
      expect(helper.identify({ timeout: '10000' as unknown as number })).not.toBe(first);
      expect(helper.identify({ timeout: null as unknown as number })).not.toBe(first);
      answer.resolve(result('5d6e7f80-91a2-4b34-8c5d-6e7f8091a2b3'));
      await first;
    });

    it('starts a new identification for another User HID and keeps the latest in the stores', async () => {
      const firstAnswer = deferred<IdentifyResult>();
      const secondAnswer = deferred<IdentifyResult>();
      agent.identify.mockReturnValueOnce(firstAnswer.promise).mockReturnValueOnce(secondAnswer.promise);
      const { helper } = renderHelper();

      const first = helper.identify();
      const second = helper.identify({ userId: USER_HID });
      expect(second).not.toBe(first);
      expect(agent.identify).not.toHaveBeenCalled();
      await settle();
      expect(agent.identify).toHaveBeenCalledTimes(2);

      secondAnswer.resolve(result('11111111-2222-4333-8444-555555555555', USER_HID));
      await second;
      expect(get(helper.result)).toEqual(result('11111111-2222-4333-8444-555555555555', USER_HID));
      expect(get(helper.isLoading)).toBe(false);

      // The older identification still resolves for its caller but no longer updates the stores.
      firstAnswer.resolve(result('66666666-7777-4888-9999-000000000000'));
      await expect(first).resolves.toEqual(result('66666666-7777-4888-9999-000000000000'));
      expect(get(helper.result)).toEqual(result('11111111-2222-4333-8444-555555555555', USER_HID));
    });

    it('shares a running identification also when another one started after it, and the stores follow it', async () => {
      const firstAnswer = deferred<IdentifyResult>();
      const secondAnswer = deferred<IdentifyResult>();
      agent.identify.mockReturnValueOnce(firstAnswer.promise).mockReturnValueOnce(secondAnswer.promise);
      const { helper } = renderHelper();
      await settle();

      const first = helper.identify();
      const second = helper.identify({ userId: USER_HID });
      // The anonymous identification still runs, and the agent would refuse a second one.
      const again = helper.identify();
      expect(again).toBe(first);
      expect(agent.identify).toHaveBeenCalledTimes(2);
      expect(get(helper.isLoading)).toBe(true);

      secondAnswer.resolve(result('11111111-2222-4333-8444-555555555555', USER_HID));
      await expect(second).resolves.toEqual(result('11111111-2222-4333-8444-555555555555', USER_HID));
      // The stores follow the identification asked for last: the anonymous one.
      expect(get(helper.result)).toBeNull();
      expect(get(helper.isLoading)).toBe(true);

      firstAnswer.resolve(result('66666666-7777-4888-9999-000000000000'));
      await expect(again).resolves.toEqual(result('66666666-7777-4888-9999-000000000000'));
      expect(get(helper.result)).toEqual(result('66666666-7777-4888-9999-000000000000'));
      expect(get(helper.isLoading)).toBe(false);
      expect(agent.identify).toHaveBeenCalledTimes(2);
    });

    it('treats a null User HID (plain JavaScript) as anonymous when sharing', async () => {
      const answer = deferred<IdentifyResult>();
      agent.identify.mockReturnValueOnce(answer.promise);
      const { helper } = renderHelper();

      const first = helper.identify();
      const second = helper.identify({ userId: null as unknown as string });
      expect(second).toBe(first);
      // A number is not shared with the anonymous run (@shieldlabs/js refuses it).
      const third = helper.identify({ userId: 42 as unknown as string });
      expect(third).not.toBe(first);
      // Neither are options that are not an object.
      const fourth = helper.identify(USER_HID as unknown as IdentifyOptions);
      expect(fourth).not.toBe(first);
      answer.resolve(result('4f3e2d1c-0b9a-4876-9543-210fedcba987'));
      await first;
      await third;
      await fourth;
    });

    it('shares on the effective User HID: a userId set to undefined or null in the call is anonymous', async () => {
      const forUser = deferred<IdentifyResult>();
      const anonymous = deferred<IdentifyResult>();
      agent.identify.mockReturnValueOnce(forUser.promise).mockReturnValueOnce(anonymous.promise);
      const { helper } = renderHelper({ userId: USER_HID });
      await settle();

      const first = helper.identify();
      const second = helper.identify({ userId: undefined });
      // The call overrides the helper's User HID: an anonymous identification, not the running one.
      expect(second).not.toBe(first);
      expect(helper.identify({ userId: null as unknown as string })).toBe(second);
      expect(helper.identify({})).toBe(first);
      expect(agent.identify).toHaveBeenCalledTimes(2);
      expect(agent.identify.mock.calls.map(([options]) => options?.userId)).toEqual([USER_HID, undefined]);

      forUser.resolve(result('7a8b9c0d-1e2f-4a3b-8c4d-5e6f7a8b9c0d', USER_HID));
      anonymous.resolve(result('8b9c0d1e-2f3a-4b4c-9d5e-6f7a8b9c0d1e'));
      await expect(first).resolves.toMatchObject({ userId: USER_HID });
      await expect(second).resolves.toMatchObject({ userId: null });
    });

    it('shares calls within one helper only: another helper starts its own identification', async () => {
      agent.identify.mockReturnValue(new Promise<IdentifyResult>(() => undefined));
      const helpers: IdentifyHelper[] = [];
      render(TwoForms, {
        props: {
          options: { publicKey: PUBLIC_KEY },
          identifyOptions: { userId: USER_HID },
          onhelper: (helper: IdentifyHelper) => helpers.push(helper),
        },
      });
      const [checkout, payment] = helpers;
      if (!checkout || !payment) throw new Error('useIdentify() did not run twice');
      await settle();

      const fromCheckout = checkout.identify();
      const fromPayment = payment.identify();
      expect(fromPayment).not.toBe(fromCheckout);
      // Within one helper, a double submit still shares.
      expect(checkout.identify()).toBe(fromCheckout);
      expect(payment.identify()).toBe(fromPayment);
      await settle();
      expect(agent.identify).toHaveBeenCalledTimes(2);
      expect(get(checkout.isLoading)).toBe(true);
      expect(get(payment.isLoading)).toBe(true);
    });

    it('an older failure does not overwrite a newer result', async () => {
      const firstAnswer = deferred<IdentifyResult>();
      agent.identify.mockReturnValueOnce(firstAnswer.promise);
      const { helper } = renderHelper();

      const first = helper.identify();
      await helper.identify({ userId: USER_HID });
      firstAnswer.reject(new ShieldLabsError('timeout', 'Too slow.'));

      await expect(first).resolves.toBeNull();
      expect(get(helper.error)).toBeNull();
      expect(get(helper.result)).toMatchObject({ userId: USER_HID });
    });
  });

  describe('reset()', () => {
    it('clears the result and the error', async () => {
      agent.identify.mockRejectedValueOnce(new ShieldLabsError('timeout', 'Too slow.'));
      const { helper } = renderHelper();

      await helper.identify();
      expect(get(helper.error)).not.toBeNull();
      helper.reset();
      expect(get(helper.error)).toBeNull();

      await helper.identify();
      expect(get(helper.result)).not.toBeNull();
      helper.reset();
      expect(get(helper.result)).toBeNull();
      await settle();
      expect(text('request-id')).toBe('');
    });

    it('stops a running identification from updating the stores', async () => {
      const answer = deferred<IdentifyResult>();
      agent.identify.mockReturnValueOnce(answer.promise);
      const { helper } = renderHelper();

      const running = helper.identify();
      await settle();
      helper.reset();
      expect(get(helper.isLoading)).toBe(false);

      answer.resolve(result('7c6b5a49-3827-4f16-a5e4-d3c2b1a09f8e'));
      await expect(running).resolves.toEqual(result('7c6b5a49-3827-4f16-a5e4-d3c2b1a09f8e'));
      expect(get(helper.result)).toBeNull();
      expect(get(helper.isLoading)).toBe(false);

      // After reset() a new call starts a new identification instead of sharing the old one.
      const next = helper.identify();
      expect(next).not.toBe(running);
      await next;
      expect(agent.identify).toHaveBeenCalledTimes(2);
    });
  });

  describe('the timeout', () => {
    it('covers the wait for the agent and its answer: the agent gets the time left', async () => {
      vi.useFakeTimers();
      const loading = deferred<ShieldLabsAgent>();
      loadMock.mockReturnValue(loading.promise);
      const { helper } = renderHelper({ userId: USER_HID, timeout: 5000 });

      const identified = helper.identify();
      await vi.advanceTimersByTimeAsync(2000);
      loading.resolve(agent);

      await expect(identified).resolves.toMatchObject({ userId: USER_HID });
      expect(agent.identify).toHaveBeenCalledWith({ userId: USER_HID, timeout: 3000 });
    });

    it('is the setup timeout when neither useIdentify() nor the call has one', async () => {
      vi.useFakeTimers();
      sharedImport(loadMock);
      const { helper } = renderHelper(undefined, { publicKey: PUBLIC_KEY, timeout: 1500 });

      const identified = helper.identify();
      await vi.advanceTimersByTimeAsync(1500);

      await expect(identified).resolves.toBeNull();
      expect(get(helper.error)).toMatchObject({
        code: 'timeout',
        message: 'The ShieldLabs agent did not load within 1500 ms.',
      });
      expect(agent.identify).not.toHaveBeenCalled();
    });

    it('ends at the load timeout when that comes first, even when the call has time left', async () => {
      vi.useFakeTimers();
      const imported = sharedImport(loadMock);
      const { helper } = renderHelper({ timeout: 8000 }, { publicKey: PUBLIC_KEY, timeout: 1000 });

      const identified = helper.identify();
      await vi.advanceTimersByTimeAsync(999);
      expect(get(helper.isLoading)).toBe(true);
      await vi.advanceTimersByTimeAsync(1);

      await expect(identified).resolves.toBeNull();
      expect(get(helper.error)).toMatchObject({ code: 'timeout', message: 'The ShieldLabs agent did not load within 1000 ms.' });
      expect(get(helper.isLoading)).toBe(false);

      // The agent that arrives later is not handed to the call that ended; the next call gets it.
      imported.resolve(agent);
      await settle();
      expect(agent.identify).not.toHaveBeenCalled();
      await expect(helper.identify()).resolves.toMatchObject({ userId: null });
      expect(agent.identify).toHaveBeenCalledTimes(1);
      expect(agent.identify).toHaveBeenCalledWith({ timeout: 8000 });
    });
  });

  describe('with autoLoad: false', () => {
    it('identify() before load() resolves null at once with not_initialized and loads nothing', async () => {
      // With fake timers nothing can time out: the call settles without waiting.
      vi.useFakeTimers();
      const { helper } = renderHelper({ userId: USER_HID, timeout: 60000 }, { publicKey: PUBLIC_KEY, autoLoad: false });

      await expect(helper.identify()).resolves.toBeNull();
      expect(get(helper.error)).toBeInstanceOf(ShieldLabsError);
      expect(get(helper.error)).toMatchObject({
        code: 'not_initialized',
        message: 'The ShieldLabs agent is not loaded: setShieldLabs() has autoLoad: false and load() has not been called.',
      });
      expect(get(helper.isLoading)).toBe(false);
      expect(get(helper.result)).toBeNull();
      expect(loadMock).not.toHaveBeenCalled();
      await settle();
      expect(text('identify-error')).toBe('not_initialized');
      expect(text('loading')).toBe('no');
    });

    it('identifies after load(), waiting for the agent within the timeout', async () => {
      vi.useFakeTimers();
      const loading = deferred<ShieldLabsAgent>();
      loadMock.mockReturnValue(loading.promise);
      let context: ShieldLabsContext | undefined;
      const { helper } = renderHelper(undefined, { publicKey: PUBLIC_KEY, autoLoad: false }, (value) => {
        context = value;
      });
      await expect(helper.identify({ userId: USER_HID })).resolves.toBeNull();

      context?.load();
      const identified = helper.identify({ userId: USER_HID });
      // The failed call does not hold back the next one.
      expect(get(helper.error)).toBeNull();
      expect(get(helper.isLoading)).toBe(true);
      await vi.advanceTimersByTimeAsync(4000);
      loading.resolve(agent);

      await expect(identified).resolves.toMatchObject({ userId: USER_HID });
      expect(agent.identify).toHaveBeenCalledTimes(1);
      expect(agent.identify).toHaveBeenCalledWith({ userId: USER_HID, timeout: 6000 });
      expect(get(helper.error)).toBeNull();
    });

    it('runOnMount before load() resolves null at once with not_initialized and does not run again after load()', async () => {
      // With fake timers nothing can time out: the identification ends without waiting.
      vi.useFakeTimers();
      let context: ShieldLabsContext | undefined;
      const { helper } = renderHelper(
        { runOnMount: true, userId: USER_HID },
        { publicKey: PUBLIC_KEY, autoLoad: false },
        (value) => {
          context = value;
        },
      );
      await settle();
      // Like identify() before load(): null with not_initialized, without waiting and without loading.
      expect(get(helper.isLoading)).toBe(false);
      expect(get(helper.result)).toBeNull();
      expect(get(helper.error)).toBeInstanceOf(ShieldLabsError);
      expect(get(helper.error)).toMatchObject({
        code: 'not_initialized',
        message: 'The ShieldLabs agent is not loaded: setShieldLabs() has autoLoad: false and load() has not been called.',
      });
      expect(text('identify-error')).toBe('not_initialized');
      expect(loadMock).not.toHaveBeenCalled();

      context?.load();
      await settle();
      expect(loadMock).toHaveBeenCalledTimes(1);
      expect(get(context!.status)).toBe('ready');
      expect(agent.identify).not.toHaveBeenCalled();
      expect(get(helper.error)).toMatchObject({ code: 'not_initialized' });

      // Calls after load() identify as usual.
      await expect(helper.identify()).resolves.toMatchObject({ userId: USER_HID });
      expect(agent.identify).toHaveBeenCalledTimes(1);
      expect(get(helper.error)).toBeNull();
    });

    it('runOnMount identifies when the root component calls load() during initialisation', async () => {
      render(ConsentApp, { props: { options: { publicKey: PUBLIC_KEY, autoLoad: false }, consent: true } });
      await settle();

      expect(loadMock).toHaveBeenCalledTimes(1);
      expect(agent.identify).toHaveBeenCalledTimes(1);
      expect(text('request-id')).toMatch(/^9b1deb4d-/);
      expect(text('identify-error')).toBe('');
    });

    it('runOnMount ends with not_initialized when load() comes from an effect after the page mounted', async () => {
      render(ConsentApp, {
        props: { options: { publicKey: PUBLIC_KEY, autoLoad: false }, consent: true, loadDuringInit: false },
      });
      await settle();

      // The effect of the root component runs after its children have mounted.
      expect(loadMock).toHaveBeenCalledTimes(1);
      expect(agent.identify).not.toHaveBeenCalled();
      expect(text('identify-error')).toBe('not_initialized');
      expect(text('request-id')).toBe('');
    });

    it('runOnMount does not run when consent arrives later', async () => {
      const view = render(ConsentApp, { props: { options: { publicKey: PUBLIC_KEY, autoLoad: false }, consent: false } });
      await settle();
      expect(loadMock).not.toHaveBeenCalled();
      expect(text('loading')).toBe('no');
      expect(text('identify-error')).toBe('not_initialized');

      await view.rerender({ consent: true });
      await settle();
      expect(loadMock).toHaveBeenCalledTimes(1);
      expect(agent.identify).not.toHaveBeenCalled();
      expect(text('request-id')).toBe('');
    });

    it('runOnMount does not identify when the component is gone before load()', async () => {
      let context: ShieldLabsContext | undefined;
      const { view } = renderHelper({ runOnMount: true }, { publicKey: PUBLIC_KEY, autoLoad: false }, (value) => {
        context = value;
      });
      await settle();
      await view.rerender({ showIdentify: false });

      context?.load();
      await settle();
      expect(loadMock).toHaveBeenCalledTimes(1);
      expect(agent.identify).not.toHaveBeenCalled();
    });
  });

  describe('runOnMount', () => {
    it('identifies once as soon as the agent is ready', async () => {
      vi.useFakeTimers();
      const loading = deferred<ShieldLabsAgent>();
      loadMock.mockReturnValue(loading.promise);
      const { helper } = renderHelper({ runOnMount: true, userId: USER_HID });
      await settle();

      expect(get(helper.isLoading)).toBe(true);
      expect(agent.identify).not.toHaveBeenCalled();

      loading.resolve(agent);
      await settle();
      expect(agent.identify).toHaveBeenCalledTimes(1);
      // It waited for the agent, so the agent gets the time left of the setup timeout.
      expect(agent.identify).toHaveBeenCalledWith({ userId: USER_HID, timeout: 10000 });
      expect(text('request-id')).toMatch(/^9b1deb4d-/);
      expect(text('user-id')).toBe(USER_HID);
    });

    it('does not identify again on re-render', async () => {
      const { view } = renderHelper({ runOnMount: true });
      await settle();
      expect(agent.identify).toHaveBeenCalledTimes(1);

      await view.rerender({ label: 'Create account' });
      await view.rerender({ identifyOptions: { runOnMount: true, userId: USER_HID } });
      await settle();
      expect(screen.getByRole('button').textContent).toBe('Create account');
      expect(agent.identify).toHaveBeenCalledTimes(1);
    });

    it('identifies again only when the component mounts again', async () => {
      const { view } = renderHelper({ runOnMount: true });
      await settle();

      await view.rerender({ showIdentify: false });
      await view.rerender({ showIdentify: true });
      await settle();
      expect(agent.identify).toHaveBeenCalledTimes(2);
      // The agent was loaded once by setShieldLabs() and once per identification, all through load().
      expect(loadMock.mock.calls.every(([options]) => options.publicKey === PUBLIC_KEY)).toBe(true);
    });

    it('a submit while the mount identification runs shares it', async () => {
      const answer = deferred<IdentifyResult>();
      agent.identify.mockReturnValueOnce(answer.promise);
      const { helper } = renderHelper({ runOnMount: true });
      await settle();

      const submitted = helper.identify();
      answer.resolve(result('3e2d1c0b-9a8f-4e7d-b6c5-a4b3c2d1e0f9'));
      await expect(submitted).resolves.toEqual(result('3e2d1c0b-9a8f-4e7d-b6c5-a4b3c2d1e0f9'));
      expect(agent.identify).toHaveBeenCalledTimes(1);
    });

    it('does not identify when the component is gone before the agent is ready', async () => {
      const loading = deferred<ShieldLabsAgent>();
      loadMock.mockReturnValue(loading.promise);
      const { view } = renderHelper({ runOnMount: true });
      await settle();
      await view.rerender({ showIdentify: false });

      loading.resolve(agent);
      await settle();
      expect(agent.identify).not.toHaveBeenCalled();
    });

    it('does not hold back checkOnLoad for the same User HID once its component is gone', async () => {
      const loading = deferred<ShieldLabsAgent>();
      loadMock.mockReturnValue(loading.promise);
      const { view } = renderHelper(
        { runOnMount: true, userId: USER_HID },
        { publicKey: PUBLIC_KEY, checkOnLoad: { userId: USER_HID } },
      );
      await settle();
      await view.rerender({ showIdentify: false });

      loading.resolve(agent);
      await settle();
      // The identification is skipped, so the background check covers the visit.
      expect(agent.identify).not.toHaveBeenCalled();
      expect(agent.check).toHaveBeenCalledTimes(1);
      expect(agent.check).toHaveBeenCalledWith({ userId: USER_HID });
    });

    it('stores the error when the mount identification fails', async () => {
      agent.identify.mockRejectedValueOnce(new ShieldLabsError('not_initialized', 'Another tab is identifying.'));
      const { helper } = renderHelper({ runOnMount: true });
      await settle();

      expect(get(helper.error)).toMatchObject({ code: 'not_initialized' });
      expect(text('identify-error')).toBe('not_initialized');
    });

    describe('after a load timeout or a load error', () => {
      /** Lets the setup timeout (10000 ms by default) run out while the import is still running. */
      async function timeOut(): Promise<void> {
        await vi.advanceTimersByTimeAsync(10000);
      }

      it('ends with the load timeout and does not run again when the agent arrives', async () => {
        vi.useFakeTimers();
        const imported = sharedImport(loadMock);
        let context: ShieldLabsContext | undefined;
        const { helper } = renderHelper(
          { runOnMount: true, userId: USER_HID },
          { publicKey: PUBLIC_KEY, checkOnLoad: { userId: USER_HID } },
          (value) => {
            context = value;
          },
        );
        await timeOut();

        expect(get(helper.error)).toMatchObject({
          code: 'timeout',
          message: 'The ShieldLabs agent did not load within 10000 ms.',
        });
        expect(get(helper.isLoading)).toBe(false);
        expect(agent.identify).not.toHaveBeenCalled();

        imported.resolve(agent);
        await settle();

        // The agent is ready now, but the identification that ended does not run again by itself.
        expect(get(context!.status)).toBe('ready');
        expect(agent.identify).not.toHaveBeenCalled();
        expect(get(helper.error)).toMatchObject({ code: 'timeout' });
        expect(get(helper.result)).toBeNull();
        expect(text('request-id')).toBe('');
        // Nothing runs for that User HID any more, so checkOnLoad covers the visit.
        expect(agent.check).toHaveBeenCalledTimes(1);
        expect(agent.check).toHaveBeenCalledWith({ userId: USER_HID });
      });

      it('ends with the load timeout also when its own timeout is longer', async () => {
        vi.useFakeTimers();
        const imported = sharedImport(loadMock);
        const { helper } = renderHelper({ runOnMount: true, timeout: 30000 }, { publicKey: PUBLIC_KEY, timeout: 1000 });
        await vi.advanceTimersByTimeAsync(1000);

        expect(get(helper.error)).toMatchObject({
          code: 'timeout',
          message: 'The ShieldLabs agent did not load within 1000 ms.',
        });
        expect(get(helper.isLoading)).toBe(false);

        imported.resolve(agent);
        await vi.advanceTimersByTimeAsync(5000);
        expect(agent.identify).not.toHaveBeenCalled();
        expect(get(helper.error)).toMatchObject({ code: 'timeout' });
      });

      it('ends at its own timeout and does not run when the agent loads later', async () => {
        const loading = deferred<ShieldLabsAgent>();
        loadMock.mockReturnValue(loading.promise);
        const { helper } = renderHelper({ runOnMount: true, timeout: 20 });
        await new Promise((resolve) => setTimeout(resolve, 40));

        expect(get(helper.error)).toMatchObject({ code: 'timeout', message: 'The ShieldLabs agent did not load within 20 ms.' });
        expect(agent.identify).not.toHaveBeenCalled();

        loading.resolve(agent);
        await settle();
        expect(agent.identify).not.toHaveBeenCalled();
        expect(get(helper.error)).toMatchObject({ code: 'timeout' });
        expect(get(helper.result)).toBeNull();
      });

      it('ends with a load error and does not run again after a later load succeeds', async () => {
        const failure = new ShieldLabsError('load_failed', 'Blocked by a content blocker.');
        loadMock.mockRejectedValueOnce(failure);
        let context: ShieldLabsContext | undefined;
        const { helper } = renderHelper({ runOnMount: true }, { publicKey: PUBLIC_KEY }, (value) => {
          context = value;
        });
        await settle();
        expect(get(helper.error)).toBe(failure);

        context?.load();
        await settle();
        expect(get(context!.status)).toBe('ready');
        expect(agent.identify).not.toHaveBeenCalled();
        expect(get(helper.error)).toBe(failure);
      });

      it('lets a later identify() of the component load again and get the agent, and runs nothing else', async () => {
        vi.useFakeTimers();
        const imported = sharedImport(loadMock);
        const { helper } = renderHelper({ runOnMount: true });
        await timeOut();
        expect(get(helper.error)).toMatchObject({ code: 'timeout' });

        const identified = helper.identify();
        await vi.advanceTimersByTimeAsync(2000);
        imported.resolve(agent);

        await expect(identified).resolves.toMatchObject({ userId: null });
        await settle();
        expect(agent.identify).toHaveBeenCalledTimes(1);
        expect(agent.identify).toHaveBeenCalledWith({ timeout: 8000 });
        expect(get(helper.error)).toBeNull();
      });
    });
  });

  it('works in components that do not use runes', async () => {
    render(LegacyApp, { props: { options: { publicKey: PUBLIC_KEY }, userId: USER_HID } });
    await settle();
    expect(screen.getByTestId('legacy-summary').textContent).toBe('ready idle');

    const answer = deferred<IdentifyResult>();
    agent.identify.mockReturnValueOnce(answer.promise);
    await fireEvent.click(screen.getByRole('button', { name: 'Legacy identify' }));
    await settle();
    expect(screen.getByTestId('legacy-summary').textContent).toBe('ready busy');

    answer.resolve(result('8d7c6b5a-4938-4271-a605-f4e3d2c1b0a9', USER_HID));
    await settle();
    expect(screen.getByTestId('legacy-summary').textContent).toBe('ready idle');
    expect(screen.getByTestId('legacy-request-id').textContent).toBe('8d7c6b5a-4938-4271-a605-f4e3d2c1b0a9');
    expect(agent.identify).toHaveBeenCalledWith({ userId: USER_HID });
  });

  it('throws a clear error without setShieldLabs() in a parent', () => {
    expect(() => render(Orphan, { props: { use: 'useIdentify' } })).toThrow(
      '[ShieldLabs] useIdentify() found no ShieldLabs setup. Call setShieldLabs() in a parent component (in SvelteKit, the root +layout.svelte).',
    );
  });
});
