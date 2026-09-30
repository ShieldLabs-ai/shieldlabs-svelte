/**
 * Server-side rendering: no window, no document. Components are compiled for the server and
 * rendered with svelte/server, as SvelteKit does.
 */
import { load } from '@shieldlabs/js';
import { get } from 'svelte/store';
import { render } from 'svelte/server';
import { describe, expect, it, vi } from 'vitest';
import type { IdentifyHelper, ShieldLabsContext } from '../src/lib/index.js';
import App from './components/App.svelte';
import LegacyApp from './components/LegacyApp.svelte';
import Orphan from './components/Orphan.svelte';
import { PUBLIC_KEY, USER_HID } from './support/fake-agent.js';

vi.mock('@shieldlabs/js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@shieldlabs/js')>();
  return { ...actual, load: vi.fn(actual.load) };
});

describe('server-side rendering', () => {
  it('runs without browser globals', () => {
    expect(typeof window).toBe('undefined');
    expect(typeof document).toBe('undefined');
  });

  it('renders the initial state and never loads the agent, identifies or checks', () => {
    const { body } = render(App, {
      props: {
        options: { publicKey: PUBLIC_KEY, checkOnLoad: { userId: USER_HID } },
        showIdentify: true,
        identifyOptions: { runOnMount: true, userId: USER_HID },
      },
    });

    expect(body).toContain('<p data-testid="root-status">loading</p>');
    expect(body).toContain('<p data-testid="status">loading</p>');
    expect(body).toContain('<p data-testid="loading">no</p>');
    expect(body).toContain('<p data-testid="request-id"></p>');
    expect(body).toMatch(/<button type="button"[^>]*>Sign up<\/button>/);
    expect(body).not.toMatch(/<button[^>]*disabled/);
    expect(load).not.toHaveBeenCalled();
  });

  it('renders components that do not use runes', () => {
    const { body } = render(LegacyApp, { props: { options: { publicKey: PUBLIC_KEY } } });

    expect(body).toContain('<p data-testid="legacy-root-status">loading</p>');
    expect(body).toContain('<p data-testid="legacy-summary">loading idle</p>');
    expect(load).not.toHaveBeenCalled();
  });

  it('calls made on the server fail with unsupported_environment instead of touching window', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    let context: ShieldLabsContext | undefined;
    let helper: IdentifyHelper | undefined;
    // svelte/server renders lazily: reading `body` runs the components.
    const { body } = render(App, {
      props: {
        options: { publicKey: PUBLIC_KEY },
        showIdentify: true,
        onsetup: (value: ShieldLabsContext) => {
          context = value;
        },
        onhelper: (value: IdentifyHelper) => {
          helper = value;
        },
      },
    });
    expect(body).toContain('loading');
    if (!context || !helper) throw new Error('The test app did not set up');

    await expect(context.identify()).rejects.toMatchObject({ code: 'unsupported_environment' });
    await expect(helper.identify()).resolves.toBeNull();
    expect(get(helper.error)).toMatchObject({ code: 'unsupported_environment' });
    // Calling the agent while rendering on the server is a mistake worth a warning, once per setup.
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledWith(
      '[ShieldLabs] setShieldLabs() could not load the agent: load() needs a browser page, not server-side rendering or a worker.',
    );
  });

  it('getAgent() on the server rejects with unsupported_environment', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    let context: ShieldLabsContext | undefined;
    const { body } = render(App, {
      props: {
        options: { publicKey: PUBLIC_KEY },
        onsetup: (value: ShieldLabsContext) => {
          context = value;
        },
      },
    });
    expect(body).toContain('loading');
    if (!context) throw new Error('The test app did not set up');

    await expect(context.getAgent()).rejects.toMatchObject({ code: 'unsupported_environment' });
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it('with autoLoad: false, load() does nothing on the server and calls fail at once', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    let context: ShieldLabsContext | undefined;
    let helper: IdentifyHelper | undefined;
    const { body } = render(App, {
      props: {
        options: { publicKey: PUBLIC_KEY, autoLoad: false },
        showIdentify: true,
        onsetup: (value: ShieldLabsContext) => {
          context = value;
        },
        onhelper: (value: IdentifyHelper) => {
          helper = value;
        },
      },
    });
    expect(body).toContain('<p data-testid="root-status">loading</p>');
    if (!context || !helper) throw new Error('The test app did not set up');

    // Safe in component initialisation, which also runs on the server.
    context.load();
    expect(load).not.toHaveBeenCalled();
    expect(get(context.status)).toBe('loading');

    // Calls do not wait for load() on the server, where the agent never loads.
    await expect(context.identify()).rejects.toMatchObject({ code: 'unsupported_environment' });
    await expect(helper.identify()).resolves.toBeNull();
    expect(get(helper.error)).toMatchObject({ code: 'unsupported_environment' });
    await expect(context.getAgent()).rejects.toMatchObject({ code: 'unsupported_environment' });
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it('getShieldLabs() and useIdentify() without setShieldLabs() throw on the server too', () => {
    expect(() => render(Orphan, { props: { use: 'getShieldLabs' } }).body).toThrow('found no ShieldLabs setup');
    expect(() => render(Orphan, { props: { use: 'useIdentify' } }).body).toThrow('found no ShieldLabs setup');
  });
});
